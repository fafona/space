import { lstatSync, realpathSync } from "node:fs";
import { posix } from "node:path";
import { types } from "node:util";

// Private metadata-only verification: this does not execute Python, bind a PM2 peer,
// authorize maintenance, or protect the interval after the caller verifies it.
// Never derive an executable or a filesystem lookup from a supplied proof.
const ENTRY = "/usr/bin/python3";
const TARGET = /^\/usr\/bin\/python3(?:\.(?:0|[1-9]\d{0,3}))?$/;
const PLATFORM_TARGET = "/usr/libexec/platform-python3.6";
const PLATFORM_PAIR = "/usr/libexec/platform-python3.6m";
const ERROR = "maintenance_trusted_python_unverified";
const FIELDS = ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink", "uid", "mode"];
const fail = () => { throw new Error(ERROR); };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const trustedPythonTargetLinkCount = (path) => path === PLATFORM_TARGET ? 2 :
  typeof path === "string" && path.length < 64 && TARGET.exec(path)?.[0] === path ? 1 : 0;
export const isTrustedPythonTarget = (path) => trustedPythonTargetLinkCount(path) !== 0;
const directoryPaths = (path) => {
  const result = ["/"];
  for (const segment of posix.dirname(path).split("/").filter(Boolean)) result.push(posix.join(result.at(-1), segment));
  return result;
};

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
  const indexes = Array.from({ length }, (_, i) => i);
  if (Reflect.ownKeys(descriptors).length !== length + 1 || descriptors.length?.value !== length ||
      indexes.some((i) => !descriptors[i]?.enumerable || !Object.hasOwn(descriptors[i], "value"))) fail();
  return indexes.map((i) => descriptors[i].value);
}

function identity(value) {
  if (typeof value !== "string" || value.length > 200) fail();
  const parts = value.split(":");
  if (parts.length !== 8 || parts.some((part, i) =>
    !(i === 3 || i === 4 ? /^(?:0|-?[1-9]\d{0,23})$/ : /^(?:0|[1-9]\d{0,23})$/).test(part))) fail();
  const result = Object.fromEntries(FIELDS.map((key, i) => [key, BigInt(parts[i])]));
  if (result.size > BigInt(Number.MAX_SAFE_INTEGER) || result.nlink > BigInt(Number.MAX_SAFE_INTEGER) ||
      result.uid > 4294967295n || result.mode > 65535n) fail();
  return result;
}

function checkIdentity(value, type, links = 1) {
  const stat = identity(value);
  const kinds = { file: 0o100000n, directory: 0o040000n, symlink: 0o120000n };
  if (typeof type !== "string" || !Object.hasOwn(kinds, type) || (stat.mode & 0o170000n) !== kinds[type] || stat.uid !== 0n) fail();
  if (type === "directory" && (stat.mode & 0o022n) !== 0n) fail();
  if (type === "file" && (stat.nlink !== BigInt(links) || (stat.mode & 0o022n) !== 0n ||
      (stat.mode & 0o111n) === 0n || stat.size < 1n || stat.size > 67108864n)) fail();
}

function node(value, role = "entry") {
  const copy = record(value, ["path", "type", "identity"]);
  if (role === "target" ? !isTrustedPythonTarget(copy.path) || copy.type !== "file"
    : role === "pair" ? copy.path !== PLATFORM_PAIR || copy.type !== "file"
      : copy.path !== ENTRY || !["file", "symlink"].includes(copy.type)) fail();
  checkIdentity(copy.identity, copy.type, role === "pair" ? 2 : role === "target" ? trustedPythonTargetLinkCount(copy.path) : 1);
  return Object.freeze(copy);
}

function chain(value, executable) {
  const paths = directoryPaths(executable);
  return Object.freeze(list(value, paths.length).map((item, i) => {
    const copy = record(item, ["path", "identity"]);
    if (copy.path !== paths[i]) fail();
    checkIdentity(copy.identity, "directory");
    return Object.freeze(copy);
  }));
}

function captureProof(value) {
  const copy = record(value, ["version", "layout", "entry", "target", "pair", "entryDirectories", "targetDirectories", "pairDirectories"]);
  if (copy.version !== 2) fail();
  const entry = node(copy.entry), target = node(copy.target, "target");
  const platform = target.path === PLATFORM_TARGET;
  if (copy.layout !== (platform ? "el8_platform_python36_pair" : "usr_bin_single") ||
      (!platform && (copy.pair !== null || copy.pairDirectories !== null))) fail();
  const pair = platform ? node(copy.pair, "pair") : null;
  if (pair && pair.identity !== target.identity) fail();
  const proof = { version: 2, layout: copy.layout, entry, target, pair,
    entryDirectories: chain(copy.entryDirectories, entry.path), targetDirectories: chain(copy.targetDirectories, target.path),
    pairDirectories: pair ? chain(copy.pairDirectories, pair.path) : null };
  const witnesses = [...proof.entryDirectories, ...proof.targetDirectories, ...(proof.pairDirectories ?? [])];
  if (witnesses.some((item) => witnesses.some((other) => item.path === other.path && item.identity !== other.identity)) ||
      (proof.entry.type === "file" && (proof.target.path !== ENTRY || proof.entry.identity !== proof.target.identity)) ||
      (proof.entry.type === "symlink" && proof.target.path === ENTRY) || JSON.stringify(proof).length > 4096) fail();
  return Object.freeze(proof);
}

function defaultPathInfo(path) {
  const stat = lstatSync(path, { bigint: true });
  return { identity: FIELDS.map((field) => String(stat[field])).join(":"),
    uid: Number(stat.uid), mode: Number(stat.mode), size: Number(stat.size), nlink: Number(stat.nlink),
    type: stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "other" };
}

function dependencies(overrides) {
  const supplied = overrides === undefined ? {} : overrides;
  if (!supplied || typeof supplied !== "object" || types.isProxy(supplied) || Array.isArray(supplied) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(supplied))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(supplied);
  if (Reflect.ownKeys(descriptors).some((key) => !["pathInfo", "canonical"].includes(key) ||
      !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], "value") ||
      typeof descriptors[key].value !== "function" || types.isProxy(descriptors[key].value))) fail();
  return { pathInfo: descriptors.pathInfo?.value ?? defaultPathInfo, canonical: descriptors.canonical?.value ?? realpathSync };
}

function observe(d) {
  const read = (path, links = 1) => {
    const info = record(d.pathInfo(path), ["identity", "uid", "mode", "size", "nlink", "type"]);
    const stat = identity(info.identity);
    if (["uid", "mode", "size", "nlink"].some((key) => !Number.isSafeInteger(info[key]) ||
        info[key] < 0 || BigInt(info[key]) !== stat[key])) fail();
    checkIdentity(info.identity, info.type, links);
    return info;
  };
  const directories = (executable) => directoryPaths(executable).map((path) => {
    const info = read(path);
    if (info.type !== "directory" || d.canonical(path) !== path) fail();
    return { path, identity: info.identity };
  });
  const entryDirectories = directories(ENTRY);
  const entry = read(ENTRY);
  if (!["file", "symlink"].includes(entry.type)) fail();
  const executable = d.canonical(ENTRY);
  if (!isTrustedPythonTarget(executable)) fail();
  const targetDirectories = directories(executable);
  const target = read(executable, trustedPythonTargetLinkCount(executable));
  if (target.type !== "file" || d.canonical(executable) !== executable || d.canonical(ENTRY) !== executable) fail();
  const platform = executable === PLATFORM_TARGET;
  const pairDirectories = platform ? directories(PLATFORM_PAIR) : null;
  const pair = platform ? read(PLATFORM_PAIR, 2) : null;
  if (pair && (pair.type !== "file" || d.canonical(PLATFORM_PAIR) !== PLATFORM_PAIR || pair.identity !== target.identity)) fail();
  return captureProof({ version: 2, layout: platform ? "el8_platform_python36_pair" : "usr_bin_single",
    entry: { path: ENTRY, type: entry.type, identity: entry.identity },
    target: { path: executable, type: target.type, identity: target.identity },
    pair: pair ? { path: PLATFORM_PAIR, type: pair.type, identity: pair.identity } : null,
    entryDirectories, targetDirectories, pairDirectories });
}

function capture(d) {
  const first = observe(d);
  const second = observe(d);
  if (!equal(first, second)) fail();
  return second;
}

export function captureTrustedPython(overrides) {
  try { return capture(dependencies(overrides)); } catch { fail(); }
}

export function verifyTrustedPython(proof, overrides) {
  try {
    const expected = captureProof(proof);
    if (!equal(expected, capture(dependencies(overrides)))) fail();
    return true;
  } catch { fail(); }
}
