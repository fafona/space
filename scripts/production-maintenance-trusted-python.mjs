import { lstatSync, realpathSync } from "node:fs";
import { posix } from "node:path";
import { types } from "node:util";

// Private metadata-only verification: this does not execute Python, bind a PM2 peer,
// authorize maintenance, or protect the interval after the caller verifies it.
// Never derive an executable or a filesystem lookup from a supplied proof.
const ENTRY = "/usr/bin/python3";
const TARGET = /^\/usr\/bin\/python3(?:\.(?:0|[1-9]\d{0,3}))?$/;
const ERROR = "maintenance_trusted_python_unverified";
const FIELDS = ["dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink", "uid", "mode"];
const fail = () => { throw new Error(ERROR); };
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export const isTrustedPythonTarget = (path) => typeof path === "string" && path.length < 64 && TARGET.exec(path)?.[0] === path;
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

function checkIdentity(value, type) {
  const stat = identity(value);
  const kinds = { file: 0o100000n, directory: 0o040000n, symlink: 0o120000n };
  if (typeof type !== "string" || !Object.hasOwn(kinds, type) || (stat.mode & 0o170000n) !== kinds[type] || stat.uid !== 0n) fail();
  if (type === "directory" && (stat.mode & 0o022n) !== 0n) fail();
  if (type === "file" && (stat.nlink !== 1n || (stat.mode & 0o022n) !== 0n ||
      (stat.mode & 0o111n) === 0n || stat.size < 1n || stat.size > 67108864n)) fail();
}

function node(value, target = false) {
  const copy = record(value, ["path", "type", "identity"]);
  if (target ? !isTrustedPythonTarget(copy.path) || copy.type !== "file"
    : copy.path !== ENTRY || !["file", "symlink"].includes(copy.type)) fail();
  checkIdentity(copy.identity, copy.type);
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
  const copy = record(value, ["version", "entry", "target", "entryDirectories", "targetDirectories"]);
  if (copy.version !== 1) fail();
  const entry = node(copy.entry), target = node(copy.target, true);
  const proof = { version: 1, entry, target,
    entryDirectories: chain(copy.entryDirectories, entry.path), targetDirectories: chain(copy.targetDirectories, target.path) };
  if (proof.entryDirectories.some((item) => proof.targetDirectories.some((other) => item.path === other.path && item.identity !== other.identity)) ||
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
  const read = (path) => {
    const info = record(d.pathInfo(path), ["identity", "uid", "mode", "size", "nlink", "type"]);
    const stat = identity(info.identity);
    if (["uid", "mode", "size", "nlink"].some((key) => !Number.isSafeInteger(info[key]) ||
        info[key] < 0 || BigInt(info[key]) !== stat[key])) fail();
    checkIdentity(info.identity, info.type);
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
  const target = read(executable);
  if (target.type !== "file" || d.canonical(executable) !== executable || d.canonical(ENTRY) !== executable) fail();
  return captureProof({ version: 1, entry: { path: ENTRY, type: entry.type, identity: entry.identity },
    target: { path: executable, type: target.type, identity: target.identity }, entryDirectories, targetDirectories });
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
