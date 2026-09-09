import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync } from "node:fs";
import { posix } from "node:path";
import { TextDecoder, types } from "node:util";

// Private, read-only evidence. The caller supplies an independently authorized
// runtime/owner and must bind ancestry, operation and boot before any stop.
// No signal, PM2, execution, discovery, or maintenance authorization exists here.
// verifyFiles deliberately proves only files, never process absence or health.
const ERROR = "production_maintenance_native_unverified";
const FIELDS = ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink", "uid", "mode"];
const FACT_KEYS = ["pid", "parentPid", "startTicks", "processIdentity", "uid", "cwd", "cwdIdentity", "executable", "executableIdentity", "commandLine", "commandLineDigest"];
const VERSION = /^(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})\.(?:0|[1-9]\d{0,3})$/;
const BOOT = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{64}$/;
const BINARY_LIMIT = 64 * 1024 * 1024;
const PACKAGE_LIMIT = 8192;
const fail = () => { throw new Error(ERROR); };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const absolute = (value, max = 1024) => typeof value === "string" && value.length > 1 && value.length <= max &&
  value.startsWith("/") && !/[\0\r\n]/.test(value) && posix.normalize(value) === value &&
  !value.endsWith("/") && value.split("/").length <= 64;

function record(value, keys) {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some((key) =>
    !descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], "value"))) fail();
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}
function list(value, length) {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== length + 1 || descriptors.length?.value !== length) fail();
  return Array.from({ length }, (_, index) => {
    const property = descriptors[index];
    if (!property?.enumerable || !Object.hasOwn(property, "value")) fail();
    return property.value;
  });
}
function frozen(value) {
  if (value && typeof value === "object") { Object.values(value).forEach(frozen); Object.freeze(value); }
  return value;
}
function context(value) {
  const result = record(value, ["runtime", "owner", "architecture"]);
  if (!absolute(result.runtime, 500) || !integer(result.owner, 0, 4294967295) ||
      !["x64", "arm64"].includes(result.architecture)) fail();
  return result;
}
function identity(value) {
  if (typeof value !== "string" || value.length > 210) fail();
  const fields = value.split(":");
  if (fields.length !== 8 || fields.some((part, i) =>
    !(i === 3 || i === 4 ? /^(?:0|-?[1-9]\d{0,24})$/ : /^(?:0|[1-9]\d{0,24})$/).test(part))) fail();
  const stat = Object.fromEntries(FIELDS.map((key, i) => [key, BigInt(fields[i])]));
  if (stat.uid > 4294967295n || stat.mode > 65535n || stat.nlink > BigInt(Number.MAX_SAFE_INTEGER) ||
      stat.size > BigInt(Number.MAX_SAFE_INTEGER)) fail();
  return stat;
}
function controlled(value, type, owner, links = null, limit = BINARY_LIMIT, executable = false) {
  const stat = identity(value);
  if ((stat.mode & 0o170000n) !== (type === "directory" ? 0o040000n : 0o100000n) ||
      ![0n, BigInt(owner)].includes(stat.uid) || (stat.mode & 0o022n) !== 0n) fail();
  if (type === "file" && (stat.nlink !== BigInt(links) || stat.size < 1n || stat.size > BigInt(limit) ||
      (executable && (stat.mode & 0o111n) === 0n))) fail();
  return stat;
}
function fact(value, c) {
  const result = record(value, FACT_KEYS);
  if (!integer(result.pid, 1, 2147483647) || !integer(result.parentPid, 1, 2147483647) || result.parentPid === result.pid ||
      typeof result.startTicks !== "string" || !/^[1-9]\d{0,24}$/.test(result.startTicks) || result.uid !== c.owner ||
      result.cwd !== c.runtime || !absolute(result.executable) || typeof result.commandLineDigest !== "string" || !SHA.test(result.commandLineDigest)) fail();
  const process = identity(result.processIdentity);
  if (process.uid !== BigInt(c.owner) || (process.mode & 0o170000n) !== 0o040000n) fail();
  controlled(result.cwdIdentity, "directory", c.owner);
  identity(result.executableIdentity);
  result.commandLine = list(result.commandLine, 3);
  if (result.commandLine.some((part) => typeof part !== "string" || part.length > 1024 || /[\0\r\n]/.test(part)) ||
      result.commandLine[0] !== result.executable || result.commandLine[2] !== "--ping" ||
      !VERSION.test(result.commandLine[1].slice("--service=".length)) || !result.commandLine[1].startsWith("--service=") ||
      hash(Buffer.from(result.commandLine.join("\0") + "\0")) !== result.commandLineDigest) fail();
  return result;
}
function layouts(c) {
  const name = `@esbuild/linux-${c.architecture}`;
  const root = c.runtime + "/node_modules", nested = root + "/tsx/node_modules";
  const p = root + "/" + name, np = nested + "/" + name, w = root + "/esbuild", nw = nested + "/esbuild";
  return [
    { kind: "root_single", platform: p, wrapper: null }, { kind: "nested_single", platform: np, wrapper: null },
    { kind: "root_pair", platform: p, wrapper: w }, { kind: "nested_pair", platform: np, wrapper: nw },
    { kind: "hoisted_pair", platform: p, wrapper: nw },
  ].map((item) => ({ ...item, name, roots: item.wrapper ? [item.platform, item.wrapper] : [item.platform],
    paths: item.wrapper ? [item.platform + "/bin/esbuild", item.wrapper + "/bin/esbuild"] : [item.platform + "/bin/esbuild"] }));
}
function directoryPaths(layout) {
  const paths = new Set(["/"]);
  for (const binary of layout.paths) {
    let current = "";
    for (const part of posix.dirname(binary).split("/").filter(Boolean)) { current += "/" + part; paths.add(current); }
  }
  return [...paths].sort();
}
function captureProof(raw, rawContext) {
  const c = context(rawContext);
  const p = record(raw, ["version", "context", "bootId", "process", "layout", "directories", "binaries", "packages"]);
  if (p.version !== 1 || !equal(context(p.context), c) || typeof p.bootId !== "string" || !BOOT.test(p.bootId)) fail();
  const process = fact(p.process, c), layout = layouts(c).find((candidate) => candidate.kind === p.layout);
  if (!layout || !layout.paths.includes(process.executable)) fail();
  const paths = directoryPaths(layout);
  const directories = list(p.directories, paths.length).map((value, i) => {
    const item = record(value, ["path", "identity"]); if (item.path !== paths[i]) fail();
    controlled(item.identity, "directory", c.owner); return item;
  });
  if (directories.find((item) => item.path === c.runtime)?.identity !== process.cwdIdentity) fail();
  const binaries = list(p.binaries, layout.paths.length).map((value, i) => {
    const item = record(value, ["path", "identity"]); if (item.path !== layout.paths[i]) fail();
    controlled(item.identity, "file", c.owner, layout.wrapper ? 2 : 1, BINARY_LIMIT, true); return item;
  });
  if (binaries.find((item) => item.path === process.executable)?.identity !== process.executableIdentity ||
      (layout.wrapper && binaries[0].identity !== binaries[1].identity)) fail();
  const packages = list(p.packages, layout.roots.length).map((value, i) => {
    const item = record(value, ["path", "identity", "sha256", "name", "version", "platformDependency"]);
    if (item.path !== layout.roots[i] + "/package.json" || typeof item.sha256 !== "string" || !SHA.test(item.sha256) ||
        item.name !== (i === 0 ? layout.name : "esbuild") || typeof item.version !== "string" || !VERSION.test(item.version) ||
        item.platformDependency !== (i === 0 ? null : item.version)) fail();
    controlled(item.identity, "file", c.owner, 1, PACKAGE_LIMIT); return item;
  });
  if ((layout.wrapper && packages[0].version !== packages[1].version) ||
      process.commandLine[1] !== "--service=" + packages[0].version) fail();
  const proof = { version: 1, context: c, bootId: p.bootId, process, layout: layout.kind, directories, binaries, packages };
  if (Buffer.byteLength(JSON.stringify(proof)) > 65536) fail();
  return frozen(proof);
}

const statIdentity = (stat) => FIELDS.map((key) => String(stat[key])).join(":");
function defaultPathInfo(path) {
  try {
    const stat = lstatSync(path, { bigint: true });
    return { identity: statIdentity(stat), uid: Number(stat.uid), mode: Number(stat.mode), size: Number(stat.size), nlink: Number(stat.nlink),
      type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : stat.isSymbolicLink() ? "symlink" : "other" };
  } catch (error) { if (error?.code === "ENOENT") return null; throw error; }
}
function defaultReadRegular(path, limit, expected) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    if (statIdentity(fstatSync(fd, { bigint: true })) !== expected.identity) fail();
    const bytes = Buffer.alloc(limit + 1); let size = 0;
    while (size < bytes.length) { const n = readSync(fd, bytes, size, bytes.length - size, null); if (!n) break; size += n; }
    if (size !== expected.size || size > limit || statIdentity(fstatSync(fd, { bigint: true })) !== expected.identity ||
        defaultPathInfo(path)?.identity !== expected.identity) fail();
    return { bytes: bytes.subarray(0, size) };
  } finally { closeSync(fd); }
}
function defaultBoot() {
  const fd = openSync("/proc/sys/kernel/random/boot_id", constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const bytes = Buffer.alloc(65); const length = readSync(fd, bytes, 0, bytes.length, 0);
    const value = new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length)).trim();
    if (length >= 65 || !BOOT.test(value)) fail(); return value;
  } finally { closeSync(fd); }
}
async function defaultReadProcess(pid) {
  // This existing module has a stdin CLI guard. Load it only on an explicit
  // live verification call, never on import or during files-only verification.
  if (!process.argv[1] || process.argv[1] === "-") fail();
  const runtime = await import("./check-production-runtime-supervision.mjs");
  return runtime.captureProcessFact(pid);
}
function dependencies(value) {
  const supplied = value ?? {};
  if (!supplied || typeof supplied !== "object" || types.isProxy(supplied) || Array.isArray(supplied) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(supplied))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(supplied);
  const defaults = { pathInfo: defaultPathInfo, canonical: realpathSync, readRegular: defaultReadRegular, readProcess: defaultReadProcess, boot: defaultBoot };
  for (const key of Reflect.ownKeys(descriptors)) {
    const entry = descriptors[key];
    if (!Object.hasOwn(defaults, key) || !entry.enumerable || !Object.hasOwn(entry, "value") ||
        typeof entry.value !== "function" || types.isProxy(entry.value)) fail();
    defaults[key] = entry.value;
  }
  return defaults;
}
function checkedInfo(value) {
  if (value === null) return null;
  const info = record(value, ["identity", "uid", "mode", "size", "nlink", "type"]), stat = identity(info.identity);
  if (["uid", "mode", "size", "nlink"].some((key) => !Number.isSafeInteger(info[key]) || info[key] < 0 || BigInt(info[key]) !== stat[key]) ||
      !["directory", "file", "symlink", "other"].includes(info.type)) fail();
  const expected = info.type === "directory" ? 0o040000n : info.type === "file" ? 0o100000n : info.type === "symlink" ? 0o120000n : null;
  if (expected !== null && (stat.mode & 0o170000n) !== expected) fail();
  return info;
}
function strictPackage(bytes) {
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes), result = JSON.parse(source);
  const stack = [];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "{") { stack.push(new Set()); if (stack.length > 32) fail(); }
    else if (source[i] === "[") { stack.push(null); if (stack.length > 32) fail(); }
    else if (source[i] === "}" || source[i] === "]") stack.pop();
    else if (source[i] === '"') {
      const start = i++;
      while (i < source.length && source[i] !== '"') { if (source[i] === "\\") i++; i++; }
      let after = i + 1; while (after < source.length && /\s/.test(source[after])) after++;
      if (source[after] === ":") {
        const key = JSON.parse(source.slice(start, i + 1)), keys = stack.at(-1);
        if (!keys || keys.has(key)) fail(); keys.add(key);
      }
    }
  }
  if (!result || typeof result !== "object" || Array.isArray(result)) fail(); return result;
}
function observeFiles(c, process, d) {
  const witness = new Map();
  const read = (path) => {
    const info = checkedInfo(d.pathInfo(path));
    if (witness.has(path) && !equal(witness.get(path), info)) fail();
    witness.set(path, info); return info;
  };
  const chain = (paths) => {
    for (const path of paths) {
      const info = read(path); if (!info) return false;
      if (info.type !== "directory") fail(); controlled(info.identity, "directory", c.owner);
      if (d.canonical(path) !== path) fail();
    }
    return true;
  };
  const candidates = layouts(c).filter((item) => item.paths.includes(process.executable));
  if (!candidates.length) fail();
  // Do not follow an arbitrary process executable or unsafe ancestor.
  const currentChain = directoryPaths({ paths: [process.executable] });
  if (!chain(currentChain)) fail();
  const binary = read(process.executable);
  if (!binary || binary.type !== "file" || binary.identity !== process.executableIdentity ||
      ![1, 2].includes(binary.nlink) || d.canonical(process.executable) !== process.executable) fail();
  controlled(binary.identity, "file", c.owner, binary.nlink, BINARY_LIMIT, true);
  const matches = [];
  for (const candidate of candidates.filter((item) => Boolean(item.wrapper) === (binary.nlink === 2))) {
    if (!chain(directoryPaths(candidate))) continue;
    const files = []; let missing = false;
    for (const path of candidate.paths) {
      const info = read(path); if (!info) { missing = true; break; }
      if (info.type !== "file") fail();
      if (info.nlink !== binary.nlink) { missing = true; break; }
      controlled(info.identity, "file", c.owner, binary.nlink, BINARY_LIMIT, true);
      if (d.canonical(path) !== path) fail(); files.push(info);
    }
    if (!missing && files.every((info) => info.identity === binary.identity)) matches.push(candidate);
  }
  if (matches.length !== 1) fail();
  const layout = matches[0], paths = directoryPaths(layout);
  const directories = paths.map((path) => ({ path, identity: witness.get(path).identity }));
  const binaries = layout.paths.map((path) => ({ path, identity: witness.get(path).identity }));
  const packages = layout.roots.map((root, index) => {
    const path = root + "/package.json", info = read(path);
    if (!info || info.type !== "file") fail(); controlled(info.identity, "file", c.owner, 1, PACKAGE_LIMIT);
    if (d.canonical(path) !== path) fail();
    const output = record(d.readRegular(path, PACKAGE_LIMIT, info), ["bytes"]);
    if (!Buffer.isBuffer(output.bytes) || output.bytes.length !== info.size || output.bytes.length > PACKAGE_LIMIT) fail();
    const bytes = Buffer.from(output.bytes), pkg = strictPackage(bytes);
    return { path, identity: info.identity, sha256: hash(bytes), name: pkg.name, version: pkg.version,
      platformDependency: index === 0 ? null : pkg.optionalDependencies?.[layout.name] ?? null };
  });
  for (const [path, before] of witness) {
    if (!equal(checkedInfo(d.pathInfo(path)), before) || (before && d.canonical(path) !== path)) fail();
  }
  return { layout: layout.kind, directories, binaries, packages };
}
async function captureLive(c, expectedFact, d) {
  const bootId = d.boot(); if (typeof bootId !== "string" || !BOOT.test(bootId)) fail();
  const first = fact(await d.readProcess(expectedFact.pid), c); if (!equal(first, expectedFact)) fail();
  const files = observeFiles(c, first, d);
  if (!equal(fact(await d.readProcess(first.pid), c), first) || d.boot() !== bootId) fail();
  return captureProof({ version: 1, context: c, bootId, process: first, ...files }, c);
}
export function validateNativeProcessProof(proof, rawContext) {
  try { return captureProof(proof, rawContext); } catch { fail(); }
}
export async function captureNativeProcessProof(rawInput, overrides) {
  try {
    const input = record(rawInput, ["fact", "runtime", "owner", "architecture"]);
    const c = context({ runtime: input.runtime, owner: input.owner, architecture: input.architecture });
    const expected = frozen(fact(input.fact, c)), d = dependencies(overrides);
    const first = await captureLive(c, expected, d), second = await captureLive(c, expected, d);
    if (!equal(first, second)) fail(); return second;
  } catch { fail(); }
}
export async function verifyNativeProcessProof(rawProof, rawContext, overrides) {
  try {
    const proof = captureProof(rawProof, rawContext), d = dependencies(overrides);
    const first = await captureLive(proof.context, proof.process, d), second = await captureLive(proof.context, proof.process, d);
    if (!equal(proof, first) || !equal(first, second)) fail(); return true;
  } catch { fail(); }
}
export async function verifyNativeFiles(rawProof, rawContext, overrides) {
  try {
    const proof = captureProof(rawProof, rawContext), d = dependencies(overrides);
    const expected = { layout: proof.layout, directories: proof.directories, binaries: proof.binaries, packages: proof.packages };
    const first = observeFiles(proof.context, proof.process, d), second = observeFiles(proof.context, proof.process, d);
    if (!equal(expected, first) || !equal(first, second)) fail(); return true;
  } catch { fail(); }
}
