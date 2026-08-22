import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_ENVIRONMENT_BYTES = 1024 * 1024;
const MAX_PUBLIC_URL_BYTES = 4096;
const MAX_ANON_KEY_BYTES = 16 * 1024;
const BUILD_ID_PATTERN = /^[0-9a-f]{40}$/;
const ANON_KEY_PATTERN = /^[A-Za-z0-9._~-]+$/;
const ERROR_CODE = "production_supabase_environment_invalid";

function invalid() {
  throw new Error(ERROR_CODE);
}

function sameIdentity(left, right) {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.nlink === right.nlink &&
    left.uid === right.uid &&
    left.mode === right.mode;
}

function sameDirectoryIdentity(left, right) {
  return left.dev === right.dev &&
    left.ino === right.ino &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs &&
    left.nlink === right.nlink &&
    left.uid === right.uid &&
    left.mode === right.mode;
}

function safeDirectoryIdentity(identity) {
  if (
    identity.isSymbolicLink() ||
    !identity.isDirectory() ||
    identity.nlink < 1n
  ) {
    return false;
  }
  if (process.platform !== "win32") {
    if (
      typeof process.getuid !== "function" ||
      identity.uid !== BigInt(process.getuid()) ||
      (identity.mode & 0o022n) !== 0n
    ) {
      return false;
    }
  }
  return true;
}

function safeFileIdentity(identity) {
  if (
    identity.isSymbolicLink() ||
    !identity.isFile() ||
    identity.nlink !== 1n ||
    identity.size <= 0n ||
    identity.size > BigInt(MAX_ENVIRONMENT_BYTES)
  ) {
    return false;
  }
  if (process.platform !== "win32") {
    if (
      typeof process.getuid !== "function" ||
      identity.uid !== BigInt(process.getuid()) ||
      (identity.mode & 0o777n) !== 0o600n
    ) {
      return false;
    }
  }
  return true;
}

function readFrozenSnapshot(path, afterRead) {
  let descriptor;
  let directoryDescriptor;
  try {
    const resolvedPath = resolve(path);
    const directoryPath = dirname(resolvedPath);
    if (
      basename(resolvedPath) !== ".env.local" ||
      realpathSync(directoryPath) !== directoryPath ||
      realpathSync(path) !== resolvedPath
    ) {
      invalid();
    }
    const directoryBefore = lstatSync(directoryPath, { bigint: true });
    if (!safeDirectoryIdentity(directoryBefore)) invalid();
    let openedDirectory = directoryBefore;
    let openPath = path;
    if (process.platform !== "win32") {
      directoryDescriptor = openSync(
        directoryPath,
        constants.O_RDONLY |
          (constants.O_DIRECTORY ?? 0) |
          (constants.O_NOFOLLOW ?? 0) |
          (constants.O_NONBLOCK ?? 0),
      );
      openedDirectory = fstatSync(directoryDescriptor, { bigint: true });
      if (
        !safeDirectoryIdentity(openedDirectory) ||
        !sameDirectoryIdentity(directoryBefore, openedDirectory)
      ) {
        invalid();
      }
      openPath = "/proc/self/fd/" + directoryDescriptor + "/.env.local";
    }
    const before = lstatSync(path, { bigint: true });
    if (!safeFileIdentity(before)) invalid();
    descriptor = openSync(
      openPath,
      constants.O_RDONLY |
        (constants.O_NOFOLLOW ?? 0) |
        (constants.O_NONBLOCK ?? 0),
    );
    const opened = fstatSync(descriptor, { bigint: true });
    if (!safeFileIdentity(opened) || !sameIdentity(before, opened)) invalid();
    const bytes = readFileSync(descriptor);
    if (afterRead !== undefined) {
      if (typeof afterRead !== "function") invalid();
      afterRead();
    }
    const after = fstatSync(descriptor, { bigint: true });
    const current = lstatSync(path, { bigint: true });
    const directoryAfter = directoryDescriptor === undefined
      ? directoryBefore
      : fstatSync(directoryDescriptor, { bigint: true });
    const currentDirectory = lstatSync(directoryPath, { bigint: true });
    if (
      realpathSync(directoryPath) !== directoryPath ||
      realpathSync(path) !== resolvedPath ||
      BigInt(bytes.length) !== opened.size ||
      !safeFileIdentity(after) ||
      !safeFileIdentity(current) ||
      !sameIdentity(opened, after) ||
      !sameIdentity(after, current) ||
      !safeDirectoryIdentity(directoryAfter) ||
      !safeDirectoryIdentity(currentDirectory) ||
      !sameDirectoryIdentity(openedDirectory, directoryAfter) ||
      !sameDirectoryIdentity(directoryAfter, currentDirectory)
    ) {
      invalid();
    }
    return {
      bytes,
      directoryIdentity: directoryAfter,
      fileIdentity: after,
    };
  } catch {
    invalid();
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (directoryDescriptor !== undefined) closeSync(directoryDescriptor);
  }
}

function encodeIdentity(identity, fields) {
  return fields.map((field) => identity[field].toString(10)).join(":");
}

function parseFrozenProductionSupabaseEnvironment(bytes, expectedBuildId) {
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    invalid();
  }
  if (source.includes("\0") || source.includes("\r")) invalid();
  const lines = source.split("\n");
  const buildId = exactAssignment(lines, "FAOLLA_WEB_BUILD_ID");
  const publicUrl = exactAssignment(lines, "NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = exactAssignment(lines, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (
    (expectedBuildId.length === 40
      ? buildId !== expectedBuildId
      : !buildId.startsWith(expectedBuildId)) ||
    !validPublicUrl(publicUrl) ||
    Buffer.byteLength(anonKey, "utf8") > MAX_ANON_KEY_BYTES ||
    !ANON_KEY_PATTERN.test(anonKey)
  ) {
    invalid();
  }
  return { buildId, publicUrl, anonKey };
}

function exactAssignment(lines, key) {
  const prefix = `${key}=`;
  const values = lines
    .filter((line) => line.startsWith(prefix))
    .map((line) => line.slice(prefix.length));
  if (values.length !== 1 || values[0].length === 0) invalid();
  return values[0];
}

function validPublicUrl(raw) {
  if (
    raw.length === 0 ||
    Buffer.byteLength(raw, "utf8") > MAX_PUBLIC_URL_BYTES ||
    raw.trim() !== raw ||
    raw.includes("?") ||
    raw.includes("#")
  ) {
    return false;
  }
  let value;
  try {
    value = new URL(raw);
  } catch {
    return false;
  }
  return (
    (value.protocol === "http:" || value.protocol === "https:") &&
    value.hostname !== "" &&
    value.username === "" &&
    value.password === "" &&
    value.search === "" &&
    value.hash === ""
  );
}

export function readFrozenProductionSupabaseEnvironment(
  path,
  expectedBuildId,
  dependencies = {},
) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    typeof expectedBuildId !== "string" ||
    (!BUILD_ID_PATTERN.test(expectedBuildId) && !/^[0-9a-f]{12}$/.test(expectedBuildId))
  ) {
    invalid();
  }
  const { bytes } = readFrozenSnapshot(path, dependencies.afterRead);
  return parseFrozenProductionSupabaseEnvironment(bytes, expectedBuildId);
}

export function readFrozenProductionSupabaseEnvironmentSnapshot(
  path,
  expectedBuildId,
  dependencies = {},
) {
  if (
    typeof path !== "string" ||
    path.length === 0 ||
    typeof expectedBuildId !== "string" ||
    !BUILD_ID_PATTERN.test(expectedBuildId)
  ) {
    invalid();
  }
  const { bytes, directoryIdentity, fileIdentity } =
    readFrozenSnapshot(path, dependencies.afterRead);
  parseFrozenProductionSupabaseEnvironment(bytes, expectedBuildId);
  return {
    directoryIdentity: encodeIdentity(directoryIdentity, [
      "dev", "ino", "mtimeNs", "ctimeNs", "nlink", "uid", "mode",
    ]),
    fileIdentity: encodeIdentity(fileIdentity, [
      "dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink", "uid", "mode",
    ]),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

function encodeForShell(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

const isMain = process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  try {
    const mode = process.argv[2];
    if (mode === "build-id") {
      if (process.argv.length !== 5 || !/^[0-9a-f]{12}$/.test(process.argv[4])) {
        invalid();
      }
      const expectedPrefix = process.argv[4];
      const { buildId } = readFrozenProductionSupabaseEnvironment(
        process.argv[3],
        expectedPrefix,
      );
      if (!buildId.startsWith(expectedPrefix)) invalid();
      process.stdout.write(buildId);
    } else if (mode === "anon-key") {
      if (process.argv.length !== 6 || !validPublicUrl(process.argv[5])) invalid();
      const { publicUrl, anonKey } =
        readFrozenProductionSupabaseEnvironment(process.argv[3], process.argv[4]);
      if (new URL(publicUrl).href !== new URL(process.argv[5]).href) invalid();
      process.stdout.write(encodeForShell(anonKey));
    } else if (mode === "snapshot") {
      if (process.argv.length !== 5 || !BUILD_ID_PATTERN.test(process.argv[4])) invalid();
      const snapshot = readFrozenProductionSupabaseEnvironmentSnapshot(
        process.argv[3],
        process.argv[4],
      );
      process.stdout.write(
        `${snapshot.directoryIdentity}\n${snapshot.fileIdentity}\n${snapshot.sha256}`,
      );
    } else {
      invalid();
    }
  } catch {
    process.exitCode = 1;
  }
}
