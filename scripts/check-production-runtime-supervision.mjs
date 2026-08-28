import { createHash } from "node:crypto";
import {
  accessSync,
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
} from "node:fs";
import http from "node:http";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const RUNTIME_SUPERVISION_CODES = Object.freeze({
  direct: "runtime_supervision_direct_next_owned",
  legacy: "runtime_supervision_legacy_npm_wrapper_owned",
  initReparented: "runtime_supervision_runtime_listener_reparented_to_init",
  listenerAbsent: "runtime_supervision_listener_absent",
  mismatch: "runtime_supervision_identity_mismatch",
  unreadable: "runtime_supervision_state_unreadable",
});

export const RUNTIME_START_WINDOW_CODES = Object.freeze({
  before: "runtime_supervision_owner_started_before_incident_window",
  during: "runtime_supervision_owner_started_during_incident_window",
  after: "runtime_supervision_owner_started_after_incident_window",
  ambiguous: "runtime_supervision_owner_start_boundary_ambiguous",
});

const BUILD_PATTERN = /^[0-9a-f]{40}$/;
const EPOCH_SECONDS_PATTERN = /^[1-9][0-9]{9}$/;
const NAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const MAX_CAPTURE_BYTES = 1024 * 1024;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fixedCode(code, status = 0) {
  process.stdout.write(`[runtime-supervision] ${code}\n`);
  process.exitCode = status;
}

function statIdentity(path) {
  const value = statSync(path, { bigint: true });
  return ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink", "uid", "mode"]
    .map((field) => value[field].toString(10))
    .join(":");
}

function linkIdentity(value) {
  return ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink", "uid", "mode"]
    .map((field) => value[field].toString(10))
    .join(":");
}

function fileIdentity(value) {
  return ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink", "uid", "mode"]
    .map((field) => value[field].toString(10))
    .join(":");
}

function sameFileIdentity(left, right) {
  return fileIdentity(left) === fileIdentity(right);
}

function safeRegularFile(value, maximumBytes, allowSystemOwner = false) {
  if (
    !value.isFile() ||
    value.isSymbolicLink() ||
    value.nlink !== 1n ||
    value.size < 1n ||
    value.size > BigInt(maximumBytes)
  ) {
    return false;
  }
  if (process.platform !== "win32") {
    if (
      typeof process.getuid !== "function" ||
      (value.uid !== BigInt(process.getuid()) && !(allowSystemOwner && value.uid === 0n)) ||
      (value.mode & 0o022n) !== 0n
    ) {
      return false;
    }
  }
  return true;
}

function regularPathProof(path, maximumBytes, allowSystemOwner = false) {
  let descriptor;
  try {
    if (realpathSync(path) !== resolve(path)) throw new Error("noncanonical_file");
    const before = lstatSync(path, { bigint: true });
    if (!safeRegularFile(before, maximumBytes, allowSystemOwner)) {
      throw new Error("invalid_regular_file");
    }
    descriptor = openSync(
      path,
      constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0),
    );
    const opened = fstatSync(descriptor, { bigint: true });
    if (
      !safeRegularFile(opened, maximumBytes, allowSystemOwner) ||
      !sameFileIdentity(before, opened)
    ) {
      throw new Error("opened_file_drift");
    }
    return { descriptor, identity: fileIdentity(opened) };
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    throw error;
  }
}

function closeAndRevalidateRegularPath(
  path,
  openedProof,
  maximumBytes,
  allowSystemOwner = false,
) {
  try {
    const after = fstatSync(openedProof.descriptor, { bigint: true });
    const current = lstatSync(path, { bigint: true });
    if (
      !safeRegularFile(after, maximumBytes, allowSystemOwner) ||
      !safeRegularFile(current, maximumBytes, allowSystemOwner) ||
      fileIdentity(after) !== openedProof.identity ||
      !sameFileIdentity(after, current) ||
      realpathSync(path) !== resolve(path)
    ) {
      throw new Error("regular_path_drift");
    }
  } finally {
    closeSync(openedProof.descriptor);
  }
}

function regularFileProof(path, maximumBytes = 64 * 1024, allowSystemOwner = false) {
  const opened = regularPathProof(path, maximumBytes, allowSystemOwner);
  try {
    const bytes = readFileSync(opened.descriptor);
    closeAndRevalidateRegularPath(path, opened, maximumBytes, allowSystemOwner);
    return {
      identity: opened.identity,
      digest: createHash("sha256").update(bytes).digest("hex"),
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    };
  } catch (error) {
    try {
      closeSync(opened.descriptor);
    } catch {
      // The descriptor may already have been closed by the final verifier.
    }
    throw error;
  }
}

function exactAssignment(source, key) {
  const prefix = `${key}=`;
  if (source.includes("\0") || source.includes("\r")) return "";
  const values = source
    .split("\n")
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length));
  return values.length === 1 ? values[0] : "";
}

function resolveExecutable(name) {
  for (const directory of String(process.env.PATH ?? "").split(":")) {
    if (!directory) continue;
    const candidate = join(directory, name);
    try {
      accessSync(candidate, constants.X_OK);
      return realpathSync(candidate);
    } catch {
      // Continue through PATH without exposing candidate paths.
    }
  }
  throw new Error("executable_unavailable");
}

function runCaptured(command, args, timeout = 5_000) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
    timeout,
    maxBuffer: MAX_CAPTURE_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0 || result.error || result.signal || typeof result.stdout !== "string") {
    throw new Error("capture_failed");
  }
  return result.stdout;
}

function captureProcessClock(referenceEpochMilliseconds) {
  const rawClockTicks = runCaptured("getconf", ["CLK_TCK"]).trim();
  const observedBeforeMilliseconds = Date.now();
  const rawUptime = readFileSync("/proc/uptime", "utf8");
  const observedAfterMilliseconds = Date.now();
  const uptimeMatch = rawUptime.match(
    /^([0-9]{1,12})\.([0-9]{1,9}) [0-9]{1,12}\.[0-9]{1,9}\n?$/,
  );
  if (
    !uptimeMatch ||
    !/^[1-9][0-9]{0,5}$/.test(rawClockTicks) ||
    !/^[1-9][0-9]{12}$/.test(referenceEpochMilliseconds) ||
    observedAfterMilliseconds < observedBeforeMilliseconds ||
    observedAfterMilliseconds - observedBeforeMilliseconds > 250 ||
    observedBeforeMilliseconds < Number(referenceEpochMilliseconds) ||
    observedBeforeMilliseconds - Number(referenceEpochMilliseconds) > 5_000
  ) {
    throw new Error("process_clock_unavailable");
  }
  const fractionalDigits = Math.min(uptimeMatch[2].length, 3);
  const uptimeMilliseconds =
    BigInt(uptimeMatch[1]) * 1000n +
    BigInt(`${uptimeMatch[2]}000`.slice(0, 3));
  return {
    clockTicksPerSecond: rawClockTicks,
    observedAfterMilliseconds: observedAfterMilliseconds.toString(10),
    observedBeforeMilliseconds: observedBeforeMilliseconds.toString(10),
    referenceEpochMilliseconds,
    uptimeQuantumMilliseconds: (10 ** (3 - fractionalDigits)).toString(10),
    uptimeMilliseconds: uptimeMilliseconds.toString(10),
  };
}

export function captureRuntimeProof(appDirectory, expectedBuildId) {
  const appRoot = realpathSync(appDirectory);
  const releasesRoot = realpathSync(`${appDirectory}.releases`);
  const currentLink = `${appDirectory}.current`;
  const appIdentity = statIdentity(appRoot);
  const releasesIdentity = statIdentity(releasesRoot);
  const currentBefore = lstatSync(currentLink, { bigint: true });
  if (!currentBefore.isSymbolicLink() || currentBefore.nlink !== 1n) {
    throw new Error("current_not_link");
  }
  const currentLinkIdentity = linkIdentity(currentBefore);
  const currentRawTarget = readlinkSync(currentLink);
  const runtime = realpathSync(currentLink);
  const runtimeIdentity = statIdentity(runtime);
  if (dirname(runtime) !== releasesRoot) throw new Error("runtime_parent_mismatch");
  if (!new RegExp(`^${expectedBuildId.slice(0, 12)}-[0-9]{14}$`).test(basename(runtime))) {
    throw new Error("runtime_name_mismatch");
  }
  const environment = regularFileProof(join(runtime, ".env.local"));
  if (
    exactAssignment(environment.text, "FAOLLA_WEB_BUILD_ID") !== expectedBuildId ||
    exactAssignment(environment.text, "NEXT_PUBLIC_FAOLLA_WEB_BUILD_ID") !== expectedBuildId
  ) {
    throw new Error("runtime_build_mismatch");
  }
  const nextBuild = regularFileProof(join(runtime, ".next", "BUILD_ID"), 129);
  const opaqueNextBuildId = nextBuild.text.endsWith("\n")
    ? nextBuild.text.slice(0, -1)
    : nextBuild.text;
  if (
    (nextBuild.text !== opaqueNextBuildId && nextBuild.text !== `${opaqueNextBuildId}\n`) ||
    !/^[A-Za-z0-9._~-]{1,128}$/.test(opaqueNextBuildId)
  ) {
    throw new Error("next_build_invalid");
  }
  const nextEntryPath = join(runtime, "node_modules", "next", "dist", "bin", "next");
  const nextEntryProof = regularPathProof(nextEntryPath, 2 * 1024 * 1024);
  closeAndRevalidateRegularPath(nextEntryPath, nextEntryProof, 2 * 1024 * 1024);
  const currentAfter = lstatSync(currentLink, { bigint: true });
  const nextEntryAfter = lstatSync(nextEntryPath, { bigint: true });
  if (
    !currentAfter.isSymbolicLink() ||
    currentAfter.nlink !== 1n ||
    linkIdentity(currentAfter) !== currentLinkIdentity ||
    readlinkSync(currentLink) !== currentRawTarget ||
    realpathSync(currentLink) !== runtime ||
    statIdentity(appRoot) !== appIdentity ||
    statIdentity(releasesRoot) !== releasesIdentity ||
    statIdentity(runtime) !== runtimeIdentity ||
    !safeRegularFile(nextEntryAfter, 2 * 1024 * 1024) ||
    fileIdentity(nextEntryAfter) !== nextEntryProof.identity ||
    realpathSync(nextEntryPath) !== resolve(nextEntryPath)
  ) {
    throw new Error("runtime_identity_drift");
  }
  return {
    appIdentity,
    releasesIdentity,
    currentLinkIdentity,
    runtime,
    runtimeIdentity,
    environmentIdentity: environment.identity,
    environmentDigest: environment.digest,
    nextBuildIdentity: nextBuild.identity,
    nextBuildDigest: nextBuild.digest,
    nextEntryPath,
    nextEntryIdentity: nextEntryProof.identity,
  };
}

function parseProcStat(raw) {
  const close = raw.lastIndexOf(")");
  const fields = close >= 0 ? raw.slice(close + 2).trim().split(/\s+/) : [];
  const state = fields[0];
  const parentPid = fields[1];
  const startTicks = fields[19];
  if (
    state === "Z" ||
    !/^[0-9]+$/.test(parentPid ?? "") ||
    !/^[1-9][0-9]*$/.test(startTicks ?? "")
  ) {
    throw new Error("invalid_proc_stat");
  }
  return { parentPid: Number(parentPid), startTicks };
}

function readBoundedProcFile(path, maximumBytes = MAX_CAPTURE_BYTES) {
  const bytes = readFileSync(path);
  if (bytes.length < 1 || bytes.length > maximumBytes) throw new Error("proc_file_size_invalid");
  return bytes;
}

function decodeCommandLine(bytes) {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!source.endsWith("\0") || source.includes("\r") || source.includes("\n")) {
    throw new Error("proc_records_invalid");
  }
  const records = source.slice(0, -1).split("\0");
  while (records.at(-1) === "") records.pop();
  if (records.length === 0 || records.some((record) => record === "")) {
    throw new Error("proc_records_invalid");
  }
  return records;
}

function captureProcessFact(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("invalid_pid");
  const procPath = `/proc/${pid}`;
  const firstRawStat = readFileSync(join(procPath, "stat"), "utf8");
  const first = parseProcStat(firstRawStat);
  const firstProcessIdentity = statIdentity(procPath);
  const firstProcessStat = statSync(procPath, { bigint: true });
  const cwd = realpathSync(join(procPath, "cwd"));
  const firstCwdIdentity = statIdentity(join(procPath, "cwd"));
  const executable = realpathSync(join(procPath, "exe"));
  const firstExecutableIdentity = statIdentity(join(procPath, "exe"));
  const commandLineBytes = readBoundedProcFile(join(procPath, "cmdline"), 64 * 1024);
  const commandLine = decodeCommandLine(commandLineBytes);
  const commandLineDigest = createHash("sha256").update(commandLineBytes).digest("hex");
  const secondRawStat = readFileSync(join(procPath, "stat"), "utf8");
  const second = parseProcStat(secondRawStat);
  const secondProcessIdentity = statIdentity(procPath);
  const secondProcessStat = statSync(procPath, { bigint: true });
  const secondCwd = realpathSync(join(procPath, "cwd"));
  const secondCwdIdentity = statIdentity(join(procPath, "cwd"));
  const secondExecutable = realpathSync(join(procPath, "exe"));
  const secondExecutableIdentity = statIdentity(join(procPath, "exe"));
  const secondCommandLineBytes = readBoundedProcFile(join(procPath, "cmdline"), 64 * 1024);
  if (
    first.parentPid !== second.parentPid ||
    first.startTicks !== second.startTicks ||
    firstProcessIdentity !== secondProcessIdentity ||
    firstProcessStat.uid !== secondProcessStat.uid ||
    cwd !== secondCwd ||
    firstCwdIdentity !== secondCwdIdentity ||
    executable !== secondExecutable ||
    firstExecutableIdentity !== secondExecutableIdentity ||
    !commandLineBytes.equals(secondCommandLineBytes)
  ) {
    throw new Error("process_identity_drift");
  }
  return {
    pid,
    parentPid: second.parentPid,
    startTicks: second.startTicks,
    processIdentity: secondProcessIdentity,
    uid: Number(secondProcessStat.uid),
    cwd: secondCwd,
    cwdIdentity: secondCwdIdentity,
    executable: secondExecutable,
    executableIdentity: secondExecutableIdentity,
    commandLine,
    commandLineDigest,
  };
}

function captureProcessChain(listenerPid) {
  const facts = [];
  const seen = new Set();
  let pid = listenerPid;
  for (let depth = 0; depth < 64; depth += 1) {
    if (seen.has(pid)) throw new Error("process_cycle");
    seen.add(pid);
    const fact = captureProcessFact(pid);
    facts.push(fact);
    if (fact.parentPid === 0 || fact.parentPid === 1) break;
    pid = fact.parentPid;
  }
  if (facts.length === 64 && facts.at(-1)?.parentPid > 1) {
    throw new Error("process_chain_too_deep");
  }
  return facts;
}

function canonicalMetadataPath(path) {
  if (typeof path !== "string" || !isAbsolute(path)) return "";
  try {
    return realpathSync(path);
  } catch {
    return "";
  }
}

function captureSelectedProcessEnvironment(pid) {
  const environmentBytes = readBoundedProcFile(`/proc/${pid}/environ`);
  const selectedKeys = [
    "args",
    "exec_interpreter",
    "exec_mode",
    "name",
    "node_args",
    "pm_cwd",
    "pm_exec_path",
    "pm_id",
  ];
  if (environmentBytes.at(-1) !== 0) throw new Error("proc_environment_invalid");
  const selectedValues = new Map(selectedKeys.map((key) => [key, []]));
  let recordStart = 0;
  for (let index = 0; index < environmentBytes.length; index += 1) {
    if (environmentBytes[index] !== 0) continue;
    if (index === recordStart) throw new Error("proc_environment_invalid");
    const record = environmentBytes.subarray(recordStart, index);
    const separator = record.indexOf(0x3d);
    if (separator <= 0) throw new Error("proc_environment_invalid");
    const keyBytes = record.subarray(0, separator);
    if (keyBytes.every((byte) => byte >= 0x20 && byte <= 0x7e)) {
      const key = keyBytes.toString("ascii");
      const matches = selectedValues.get(key);
      if (matches) {
        const value = new TextDecoder("utf-8", { fatal: true })
          .decode(record.subarray(separator + 1));
        if (value.includes("\0") || value.includes("\r") || value.includes("\n")) {
          throw new Error("proc_environment_metadata_invalid");
        }
        matches.push(value);
      }
    }
    recordStart = index + 1;
  }
  const selected = {};
  for (const [key, values] of selectedValues) {
    if (values.length > 1) throw new Error("duplicate_proc_environment_metadata");
    selected[key] = values.length === 1 ? values[0] : null;
  }
  return {
    selected,
    digest: createHash("sha256").update(environmentBytes).digest("hex"),
  };
}

function isPm2DaemonFact(fact, nodePath, expectedUid) {
  if (
    !isRecord(fact) ||
    fact.executable !== nodePath ||
    fact.uid !== expectedUid ||
    !Array.isArray(fact.commandLine) ||
    fact.commandLine.length !== 1
  ) {
    return false;
  }
  return /^PM2 v[0-9]+(?:\.[0-9]+){1,3}(?:[-+][A-Za-z0-9._-]+)?: God Daemon \([^\0\r\n]{1,4096}\)$/
    .test(fact.commandLine[0]);
}

function capturePm2Ownership(chain, appName, runtime, port, nextPath) {
  if (typeof process.getuid !== "function") throw new Error("uid_unavailable");
  const expectedUid = process.getuid();
  const nodePath = realpathSync(process.execPath);
  const nodeProof = regularPathProof(nodePath, 256 * 1024 * 1024, true);
  closeAndRevalidateRegularPath(nodePath, nodeProof, 256 * 1024 * 1024, true);
  const daemonIndexes = chain
    .map((fact, index) => isPm2DaemonFact(fact, nodePath, expectedUid) ? index : -1)
    .filter((index) => index >= 0);
  if (daemonIndexes.length === 0) {
    return chain.length === 1 && chain[0].parentPid === 1
      ? { state: "init_reparented", mode: "none", pid: 0 }
      : { state: "mismatch", mode: "unknown", pid: 0 };
  }
  if (daemonIndexes.length !== 1 || daemonIndexes[0] === 0) {
    return { state: "mismatch", mode: "unknown", pid: 0 };
  }
  const daemonIndex = daemonIndexes[0];
  const owner = chain[daemonIndex - 1];
  const daemon = chain[daemonIndex];
  if (
    owner.parentPid !== daemon.pid ||
    owner.uid !== expectedUid ||
    owner.executable !== nodePath ||
    owner.cwd !== runtime
  ) {
    return { state: "mismatch", mode: "unknown", pid: owner.pid };
  }
  const environment = captureSelectedProcessEnvironment(owner.pid);
  const values = environment.selected;
  if (
    values.name !== appName ||
    !/^[0-9]+$/.test(values.pm_id ?? "") ||
    values.exec_mode !== "fork_mode" ||
    ![null, ""].includes(values.node_args) ||
    canonicalMetadataPath(values.pm_cwd) !== runtime
  ) {
    return {
      state: "mismatch",
      mode: "unknown",
      pid: owner.pid,
      environmentDigest: environment.digest,
    };
  }
  const interpreter = values.exec_interpreter;
  if (interpreter !== "node" && canonicalMetadataPath(interpreter) !== nodePath) {
    return {
      state: "mismatch",
      mode: "unknown",
      pid: owner.pid,
      environmentDigest: environment.digest,
    };
  }
  const execPath = canonicalMetadataPath(values.pm_exec_path);
  let mode = "unknown";
  let npmIdentity = "";
  if (
    execPath === nextPath &&
    (values.args === null || values.args === `start,-p,${port}`)
  ) {
    mode = "direct";
  } else {
    const npmPath = resolveExecutable("npm");
    const npmProof = regularPathProof(npmPath, 2 * 1024 * 1024, true);
    closeAndRevalidateRegularPath(npmPath, npmProof, 2 * 1024 * 1024, true);
    npmIdentity = npmProof.identity;
    if (
      execPath === npmPath &&
      (values.args === null || values.args === `start,--,-p,${port}`)
    ) {
      mode = "legacy";
    }
  }
  return {
    state: "owned",
    mode,
    pid: owner.pid,
    daemonPid: daemon.pid,
    environmentDigest: environment.digest,
    nodeIdentity: nodeProof.identity,
    npmIdentity,
  };
}

function captureListener(port) {
  const output = runCaptured("ss", ["-H", "-ltnp", `( sport = :${port} )`]);
  if (output.trim() === "") return { state: "absent", pid: 0, chain: [] };
  const pids = [...output.matchAll(/\bpid=([1-9][0-9]*)\b/g)].map((match) => Number(match[1]));
  const unique = [...new Set(pids)];
  if (unique.length !== 1) return { state: "mismatch", pid: 0, chain: [] };
  return {
    state: "single",
    pid: unique[0],
    chain: captureProcessChain(unique[0]),
  };
}

async function captureHealth(port, expectedBuildId) {
  return await new Promise((resolve) => {
    let settled = false;
    let deadline;
    let request;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(value);
    };
    deadline = setTimeout(() => {
      request?.destroy();
      finish(false);
    }, 4_500);
    try {
      request = http.get({
        host: "127.0.0.1",
        port,
        path: "/api/app-web-version",
        timeout: 4_000,
        headers: { accept: "application/json" },
      }, (response) => {
        let body = "";
        let bodyBytes = 0;
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          bodyBytes += Buffer.byteLength(chunk);
          if (bodyBytes > 16_384) {
            response.destroy();
            finish(false);
            return;
          }
          body += chunk;
        });
        response.on("end", () => {
          try {
            const parsed = JSON.parse(body);
            finish(response.statusCode === 200 && parsed?.buildId === expectedBuildId);
          } catch {
            finish(false);
          }
        });
        response.on("error", () => finish(false));
      });
      request.on("timeout", () => request.destroy());
      request.on("error", () => finish(false));
    } catch {
      finish(false);
    }
  });
}

async function captureSupervisionSnapshot(appName, runtimeProof, port, expectedBuildId) {
  const listener = captureListener(port);
  const ownership = listener.state === "single"
    ? capturePm2Ownership(
      listener.chain,
      appName,
      runtimeProof.runtime,
      port,
      runtimeProof.nextEntryPath,
    )
    : { state: "unknown", mode: "unknown", pid: 0 };
  const healthVerified = await captureHealth(port, expectedBuildId);
  return { ownership, listener, healthVerified };
}

export function classifyRuntimeSupervision(snapshot) {
  if (!isRecord(snapshot) || snapshot.stable !== true) {
    return RUNTIME_SUPERVISION_CODES.unreadable;
  }
  const { ownership, listener, runtime } = snapshot;
  if (!isRecord(ownership) || !isRecord(listener) || typeof runtime !== "string") {
    return RUNTIME_SUPERVISION_CODES.unreadable;
  }
  if (listener.state === "absent") return RUNTIME_SUPERVISION_CODES.listenerAbsent;
  if (listener.state !== "single" || !Array.isArray(listener.chain) || listener.chain.length === 0) {
    return RUNTIME_SUPERVISION_CODES.mismatch;
  }
  if (snapshot.healthVerified !== true) return RUNTIME_SUPERVISION_CODES.unreadable;
  const listenerFact = listener.chain[0];
  if (listenerFact.pid !== listener.pid || listenerFact.cwd !== runtime) {
    return RUNTIME_SUPERVISION_CODES.mismatch;
  }
  if (ownership.state === "init_reparented") {
    return RUNTIME_SUPERVISION_CODES.initReparented;
  }
  if (ownership.state !== "owned" || !["direct", "legacy"].includes(ownership.mode)) {
    return RUNTIME_SUPERVISION_CODES.mismatch;
  }
  const supervisorFact = listener.chain.find((fact) => fact.pid === ownership.pid);
  if (!supervisorFact || supervisorFact.cwd !== runtime) {
    return RUNTIME_SUPERVISION_CODES.mismatch;
  }
  if (ownership.mode === "direct") {
    return listener.pid === ownership.pid
      ? RUNTIME_SUPERVISION_CODES.direct
      : RUNTIME_SUPERVISION_CODES.mismatch;
  }
  return listener.pid !== ownership.pid
    ? RUNTIME_SUPERVISION_CODES.legacy
    : RUNTIME_SUPERVISION_CODES.mismatch;
}

export function classifyRuntimeStartWindow(
  snapshot,
  processClock,
  incidentStartedAtEpoch,
  incidentEndedAtEpoch,
) {
  if (
    !isRecord(snapshot) ||
    snapshot.stable !== true ||
    !isRecord(snapshot.ownership) ||
    snapshot.ownership.state !== "owned" ||
    !Array.isArray(snapshot.listener?.chain) ||
    !isRecord(processClock) ||
    !/^[1-9][0-9]{12}$/.test(processClock.observedBeforeMilliseconds ?? "") ||
    !/^[1-9][0-9]{12}$/.test(processClock.observedAfterMilliseconds ?? "") ||
    !/^[1-9][0-9]{12}$/.test(processClock.referenceEpochMilliseconds ?? "") ||
    !/^[1-9][0-9]*$/.test(processClock.uptimeMilliseconds ?? "") ||
    !/^[1-9][0-9]{0,2}$/.test(processClock.uptimeQuantumMilliseconds ?? "") ||
    !/^[1-9][0-9]{0,5}$/.test(processClock.clockTicksPerSecond ?? "") ||
    !EPOCH_SECONDS_PATTERN.test(incidentStartedAtEpoch ?? "") ||
    !EPOCH_SECONDS_PATTERN.test(incidentEndedAtEpoch ?? "")
  ) {
    return RUNTIME_SUPERVISION_CODES.unreadable;
  }
  const owner = snapshot.listener.chain.find(
    (fact) => fact?.pid === snapshot.ownership.pid,
  );
  if (!isRecord(owner) || !/^[1-9][0-9]*$/.test(owner.startTicks ?? "")) {
    return RUNTIME_SUPERVISION_CODES.unreadable;
  }
  try {
    const observedBeforeMilliseconds = BigInt(
      processClock.observedBeforeMilliseconds,
    );
    const observedAfterMilliseconds = BigInt(
      processClock.observedAfterMilliseconds,
    );
    const referenceEpochMilliseconds = BigInt(
      processClock.referenceEpochMilliseconds,
    );
    const uptimeMilliseconds = BigInt(processClock.uptimeMilliseconds);
    const uptimeQuantumMilliseconds = BigInt(
      processClock.uptimeQuantumMilliseconds,
    );
    if (
      observedAfterMilliseconds < observedBeforeMilliseconds ||
      observedAfterMilliseconds - observedBeforeMilliseconds > 250n ||
      observedBeforeMilliseconds < referenceEpochMilliseconds ||
      observedBeforeMilliseconds > referenceEpochMilliseconds + 5_000n
    ) {
      return RUNTIME_SUPERVISION_CODES.unreadable;
    }
    const clockTicksPerSecond = BigInt(processClock.clockTicksPerSecond);
    const processUptimeMilliseconds =
      (BigInt(owner.startTicks) * 1000n) /
      clockTicksPerSecond;
    if (processUptimeMilliseconds > uptimeMilliseconds) {
      return RUNTIME_SUPERVISION_CODES.unreadable;
    }
    const tickCeilingMilliseconds =
      (1000n + clockTicksPerSecond - 1n) / clockTicksPerSecond;
    const processLowerMilliseconds = observedBeforeMilliseconds -
      uptimeMilliseconds + processUptimeMilliseconds -
      uptimeQuantumMilliseconds;
    const processUpperMilliseconds = observedAfterMilliseconds -
      uptimeMilliseconds + processUptimeMilliseconds +
      tickCeilingMilliseconds;
    const incidentStartedMilliseconds = BigInt(incidentStartedAtEpoch) * 1000n;
    const incidentEndedMilliseconds = BigInt(incidentEndedAtEpoch) * 1000n;
    const boundaryGuardMilliseconds = 6_000n;
    if (incidentEndedMilliseconds <= incidentStartedMilliseconds) {
      return RUNTIME_SUPERVISION_CODES.unreadable;
    }
    if (
      processUpperMilliseconds <
        incidentStartedMilliseconds - boundaryGuardMilliseconds
    ) {
      return RUNTIME_START_WINDOW_CODES.before;
    }
    if (
      processLowerMilliseconds >=
        incidentStartedMilliseconds + boundaryGuardMilliseconds &&
      processUpperMilliseconds <=
        incidentEndedMilliseconds - boundaryGuardMilliseconds
    ) {
      return RUNTIME_START_WINDOW_CODES.during;
    }
    if (
      processLowerMilliseconds >
        incidentEndedMilliseconds + boundaryGuardMilliseconds
    ) {
      return RUNTIME_START_WINDOW_CODES.after;
    }
    return RUNTIME_START_WINDOW_CODES.ambiguous;
  } catch {
    return RUNTIME_SUPERVISION_CODES.unreadable;
  }
}

async function main() {
  const [
    appDirectory,
    appName,
    rawPort,
    expectedBuildId,
    incidentStartedAtEpoch = "",
    incidentEndedAtEpoch = "",
    observationReferenceEpochMilliseconds = "",
  ] = process.argv.slice(2);
  const port = Number(rawPort);
  const incidentWindowRequested =
    incidentStartedAtEpoch !== "" || incidentEndedAtEpoch !== "" ||
    observationReferenceEpochMilliseconds !== "";
  if (
    !isAbsolute(appDirectory ?? "") ||
    !NAME_PATTERN.test(appName ?? "") ||
    !Number.isSafeInteger(port) ||
    port < 1 ||
    port > 65_535 ||
    !BUILD_PATTERN.test(expectedBuildId ?? "") ||
    (incidentWindowRequested &&
      (!EPOCH_SECONDS_PATTERN.test(incidentStartedAtEpoch) ||
        !EPOCH_SECONDS_PATTERN.test(incidentEndedAtEpoch) ||
        !/^[1-9][0-9]{12}$/.test(observationReferenceEpochMilliseconds) ||
        BigInt(incidentEndedAtEpoch) <= BigInt(incidentStartedAtEpoch) ||
        BigInt(incidentEndedAtEpoch) - BigInt(incidentStartedAtEpoch) > 3600n))
  ) {
    fixedCode(RUNTIME_SUPERVISION_CODES.unreadable, 23);
    return;
  }
  try {
    let processClock = null;
    if (incidentWindowRequested) {
      try {
        processClock = captureProcessClock(
          observationReferenceEpochMilliseconds,
        );
      } catch {
        processClock = null;
      }
    }
    const firstRuntime = captureRuntimeProof(appDirectory, expectedBuildId);
    const first = await captureSupervisionSnapshot(appName, firstRuntime, port, expectedBuildId);
    await new Promise((resolve) => setTimeout(resolve, 250));
    const secondRuntime = captureRuntimeProof(appDirectory, expectedBuildId);
    const second = await captureSupervisionSnapshot(appName, secondRuntime, port, expectedBuildId);
    const stable = JSON.stringify(firstRuntime) === JSON.stringify(secondRuntime) &&
      JSON.stringify(first) === JSON.stringify(second);
    const stableSnapshot = {
      ...second,
      runtime: secondRuntime.runtime,
      stable,
    };
    let code = classifyRuntimeSupervision(stableSnapshot);
    if (
      incidentWindowRequested &&
      [RUNTIME_SUPERVISION_CODES.direct, RUNTIME_SUPERVISION_CODES.legacy]
        .includes(code)
    ) {
      code = processClock === null
        ? RUNTIME_SUPERVISION_CODES.unreadable
        : classifyRuntimeStartWindow(
          stableSnapshot,
          processClock,
          incidentStartedAtEpoch,
          incidentEndedAtEpoch,
        );
    }
    const statusByCode = new Map([
      [RUNTIME_SUPERVISION_CODES.direct, 0],
      [RUNTIME_SUPERVISION_CODES.legacy, 0],
      [RUNTIME_SUPERVISION_CODES.initReparented, 20],
      [RUNTIME_SUPERVISION_CODES.listenerAbsent, 21],
      [RUNTIME_SUPERVISION_CODES.mismatch, 22],
      [RUNTIME_SUPERVISION_CODES.unreadable, 23],
      [RUNTIME_START_WINDOW_CODES.before, 0],
      [RUNTIME_START_WINDOW_CODES.during, 24],
      [RUNTIME_START_WINDOW_CODES.after, 25],
      [RUNTIME_START_WINDOW_CODES.ambiguous, 26],
    ]);
    fixedCode(code, statusByCode.get(code) ?? 23);
  } catch {
    fixedCode(RUNTIME_SUPERVISION_CODES.unreadable, 23);
  }
}

if (process.argv[1] === "-" || import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
