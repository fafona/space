import { createHash } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readFileSync,
  readlinkSync,
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
const PROCESS_SUPABASE_ENVIRONMENT_KEYS = [
  "SUPABASE_INTERNAL_URL",
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
];
const PROCESS_STAFF_ROLLOUT_ENVIRONMENT_KEYS = [
  "MERCHANT_STAFF_BUSINESS_RBAC_MODE",
  "MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS",
  "FAOLLA_CANONICAL_PORTAL_ORIGIN",
];
const STAFF_SITE_IDS_PATTERN = /^[0-9]{8}(?:,[0-9]{8}){0,49}$/;
const CANONICAL_PORTAL_ORIGIN = "https://launch.faolla.com";

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

function decodeEnvironmentLines(bytes) {
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    invalid();
  }
  if (source.includes("\0") || source.includes("\r")) invalid();
  return source.split("\n");
}

function assignmentReferencePattern(key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^\\s*(?:export\\s+)?${escapedKey}(?:\\s*=|\\s*:\\s+|\\s*$)`,
  );
}

function optionalExactAssignment(lines, key, { allowEmpty = false } = {}) {
  const prefix = `${key}=`;
  const values = [];
  const referencePattern = assignmentReferencePattern(key);
  for (const line of lines) {
    if (line.startsWith(prefix)) {
      values.push(line.slice(prefix.length));
    } else if (referencePattern.test(line)) {
      // Dotenv accepts several non-canonical assignment spellings. Reject
      // those spellings instead of mistaking an effective assignment for an
      // absent, fail-closed rollout key.
      invalid();
    }
  }
  if (values.length > 1 || (!allowEmpty && values[0]?.length === 0)) invalid();
  return values[0];
}

function validStaffSiteIds(raw) {
  if (!STAFF_SITE_IDS_PATTERN.test(raw)) return false;
  const siteIds = raw.split(",");
  return new Set(siteIds).size === siteIds.length;
}

function parseFrozenStaffBusinessRolloutEnvironment(lines) {
  const mode = optionalExactAssignment(
    lines,
    "MERCHANT_STAFF_BUSINESS_RBAC_MODE",
  );
  const siteIds = optionalExactAssignment(
    lines,
    "MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS",
    { allowEmpty: true },
  );
  const portalOrigin = optionalExactAssignment(
    lines,
    "FAOLLA_CANONICAL_PORTAL_ORIGIN",
  );

  if (mode === undefined) {
    if (
      siteIds !== undefined ||
      (portalOrigin !== undefined && portalOrigin !== CANONICAL_PORTAL_ORIGIN)
    ) {
      invalid();
    }
    return {
      rolloutStatus: "legacy-off",
      staffBusinessRbacMode: "off",
      staffBusinessRbacSiteIds: "",
      // An empty explicit process value reproduces the old release's own
      // fallback without inheriting a candidate or PM2 daemon value.
      canonicalPortalOrigin: portalOrigin ?? "",
    };
  }
  if (portalOrigin !== CANONICAL_PORTAL_ORIGIN) invalid();
  if (mode === "off") {
    // The persisted canonical off representation omits the allowlist. The
    // launcher later passes an explicit empty process value to override both
    // the invoking shell and a stale PM2 daemon environment.
    if (siteIds !== undefined) invalid();
    return {
      rolloutStatus: "explicit",
      staffBusinessRbacMode: mode,
      staffBusinessRbacSiteIds: "",
      canonicalPortalOrigin: portalOrigin,
    };
  }
  if (mode !== "enforce" || siteIds === undefined || !validStaffSiteIds(siteIds)) {
    invalid();
  }
  return {
    rolloutStatus: "explicit",
    staffBusinessRbacMode: mode,
    staffBusinessRbacSiteIds: siteIds,
    canonicalPortalOrigin: portalOrigin,
  };
}

function parseFrozenProductionSupabaseEnvironment(bytes, expectedBuildId) {
  const lines = decodeEnvironmentLines(bytes);
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

function parseFrozenProductionSupabaseRollbackEnvironment(bytes, expectedBuildId) {
  const lines = decodeEnvironmentLines(bytes);
  const buildId = exactAssignment(lines, "FAOLLA_WEB_BUILD_ID");
  const internalUrl = exactAssignment(lines, "SUPABASE_INTERNAL_URL");
  const publicUrl = exactAssignment(lines, "NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = exactAssignment(lines, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
  if (
    buildId !== expectedBuildId ||
    !validPublicUrl(internalUrl) ||
    !validPublicUrl(publicUrl) ||
    Buffer.byteLength(anonKey, "utf8") > MAX_ANON_KEY_BYTES ||
    !ANON_KEY_PATTERN.test(anonKey)
  ) {
    invalid();
  }
  return {
    buildId,
    internalUrl,
    publicUrl,
    anonKey,
    ...parseFrozenStaffBusinessRolloutEnvironment(lines),
  };
}

function exactAssignment(lines, key) {
  const value = optionalExactAssignment(lines, key);
  if (value === undefined) invalid();
  return value;
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

export function readFrozenProductionSupabaseRollbackEnvironmentSnapshot(
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
  const environment = parseFrozenProductionSupabaseRollbackEnvironment(
    bytes,
    expectedBuildId,
  );
  return {
    ...environment,
    directoryIdentity: encodeIdentity(directoryIdentity, [
      "dev", "ino", "mtimeNs", "ctimeNs", "nlink", "uid", "mode",
    ]),
    fileIdentity: encodeIdentity(fileIdentity, [
      "dev", "ino", "size", "mtimeNs", "ctimeNs", "nlink", "uid", "mode",
    ]),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function parseProductionProcessSupabaseEnvironment(bytes) {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.length === 0 ||
    bytes.length > MAX_ENVIRONMENT_BYTES
  ) {
    invalid();
  }
  let source;
  try {
    source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    invalid();
  }
  const entries = source.split("\0").filter((entry) => entry.length > 0);
  const readValues = (keys, emptyAllowedKeys = new Set()) => keys.map((key) => {
    if (entries.includes(key)) invalid();
    const prefix = `${key}=`;
    const matches = entries.filter((entry) => entry.startsWith(prefix));
    if (matches.length > 1) invalid();
    if (matches.length === 0) return undefined;
    const value = matches[0].slice(prefix.length);
    if (
      (!emptyAllowedKeys.has(key) && value.length === 0) ||
      Buffer.byteLength(value, "utf8") > MAX_ANON_KEY_BYTES ||
      /[\r\n\0]/.test(value)
    ) {
      invalid();
    }
    return value;
  });
  const supabaseValues = readValues(PROCESS_SUPABASE_ENVIRONMENT_KEYS);
  const rolloutValues = readValues(
    PROCESS_STAFF_ROLLOUT_ENVIRONMENT_KEYS,
    new Set([
      "MERCHANT_STAFF_BUSINESS_RBAC_SITE_IDS",
      "FAOLLA_CANONICAL_PORTAL_ORIGIN",
    ]),
  );
  const supabasePresentCount = supabaseValues
    .filter((value) => value !== undefined).length;
  const rolloutPresentCount = rolloutValues
    .filter((value) => value !== undefined).length;
  if (
    ![0, PROCESS_SUPABASE_ENVIRONMENT_KEYS.length].includes(supabasePresentCount) ||
    ![0, PROCESS_STAFF_ROLLOUT_ENVIRONMENT_KEYS.length].includes(
      rolloutPresentCount,
    )
  ) {
    invalid();
  }

  const result = {
    status: supabasePresentCount === 0 ? "absent" : "present",
    rolloutStatus: rolloutPresentCount === 0 ? "absent" : "present",
  };
  if (supabasePresentCount !== 0) {
    const [internalUrl, publicUrl, anonKey] = supabaseValues;
    if (
      !validPublicUrl(internalUrl) ||
      !validPublicUrl(publicUrl) ||
      !ANON_KEY_PATTERN.test(anonKey)
    ) {
      invalid();
    }
    Object.assign(result, { internalUrl, publicUrl, anonKey });
  }
  if (rolloutPresentCount !== 0) {
    const [staffBusinessRbacMode, staffBusinessRbacSiteIds, canonicalPortalOrigin] =
      rolloutValues;
    if (
      (staffBusinessRbacMode === "off" && staffBusinessRbacSiteIds !== "") ||
      (staffBusinessRbacMode === "off" &&
        !["", CANONICAL_PORTAL_ORIGIN].includes(canonicalPortalOrigin)) ||
      (staffBusinessRbacMode === "enforce" &&
        (!validStaffSiteIds(staffBusinessRbacSiteIds) ||
          canonicalPortalOrigin !== CANONICAL_PORTAL_ORIGIN)) ||
      !["off", "enforce"].includes(staffBusinessRbacMode)
    ) {
      invalid();
    }
    Object.assign(result, {
      staffBusinessRbacMode,
      staffBusinessRbacSiteIds,
      canonicalPortalOrigin,
    });
  }
  return result;
}

export function captureStableProductionProcessSupabaseEnvironment(
  pid,
  runtimeDirectory,
  dependencies = {},
) {
  if (
    typeof pid !== "string" ||
    !/^[1-9][0-9]*$/.test(pid) ||
    typeof runtimeDirectory !== "string" ||
    runtimeDirectory.length === 0
  ) {
    invalid();
  }
  try {
    const resolveRuntime = dependencies.resolveRuntime ?? realpathSync;
    const expectedRuntime = resolveRuntime(runtimeDirectory);
    const readIdentity = dependencies.readIdentity ?? (() => {
      const rawStat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const close = rawStat.lastIndexOf(")");
      const fields = close >= 0 ? rawStat.slice(close + 2).trim().split(/\s+/) : [];
      return {
        cwd: realpathSync(readlinkSync(`/proc/${pid}/cwd`)),
        startTicks: fields[19],
        state: fields[0],
      };
    });
    const readEnvironment = dependencies.readEnvironment ??
      (() => readFileSync(`/proc/${pid}/environ`));
    const before = readIdentity();
    const environmentBytes = readEnvironment();
    const after = readIdentity();
    for (const identity of [before, after]) {
      if (
        identity?.cwd !== expectedRuntime ||
        !/^[1-9][0-9]*$/.test(identity?.startTicks ?? "") ||
        identity?.state === "Z"
      ) {
        invalid();
      }
    }
    if (
      before.cwd !== after.cwd ||
      before.startTicks !== after.startTicks
    ) {
      invalid();
    }
    return {
      startTicks: before.startTicks,
      ...parseProductionProcessSupabaseEnvironment(environmentBytes),
    };
  } catch {
    invalid();
  }
}

function encodeForShell(value) {
  return Buffer.from(value, "utf8").toString("base64");
}

function encodePossiblyEmptyForShell(value) {
  // Standard base64 never contains "-". Keep every CLI field nonempty so
  // Bash command substitution cannot erase a trailing legacy empty value.
  return value.length === 0 ? "-" : encodeForShell(value);
}

export function formatProductionProcessEnvironmentSnapshotForShell(snapshot) {
  if (
    snapshot === null ||
    typeof snapshot !== "object" ||
    !["present", "absent"].includes(snapshot.status) ||
    !["present", "absent"].includes(snapshot.rolloutStatus) ||
    !/^[1-9][0-9]*$/.test(snapshot.startTicks ?? "")
  ) {
    invalid();
  }
  const output = [snapshot.status, snapshot.rolloutStatus, snapshot.startTicks];
  if (snapshot.status === "present") {
    if (
      typeof snapshot.internalUrl !== "string" ||
      typeof snapshot.publicUrl !== "string" ||
      typeof snapshot.anonKey !== "string"
    ) {
      invalid();
    }
    output.push(
      encodeForShell(snapshot.internalUrl),
      encodeForShell(snapshot.publicUrl),
      encodeForShell(snapshot.anonKey),
    );
  }
  if (snapshot.rolloutStatus === "present") {
    if (
      typeof snapshot.staffBusinessRbacMode !== "string" ||
      typeof snapshot.staffBusinessRbacSiteIds !== "string" ||
      typeof snapshot.canonicalPortalOrigin !== "string"
    ) {
      invalid();
    }
    output.push(
      encodeForShell(snapshot.staffBusinessRbacMode),
      encodePossiblyEmptyForShell(snapshot.staffBusinessRbacSiteIds),
      encodePossiblyEmptyForShell(snapshot.canonicalPortalOrigin),
    );
  }
  return output.join("\n");
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
    } else if (mode === "rollback-snapshot") {
      if (process.argv.length !== 5 || !BUILD_ID_PATTERN.test(process.argv[4])) invalid();
      const snapshot = readFrozenProductionSupabaseRollbackEnvironmentSnapshot(
        process.argv[3],
        process.argv[4],
      );
      process.stdout.write([
        snapshot.directoryIdentity,
        snapshot.fileIdentity,
        snapshot.sha256,
        encodeForShell(snapshot.internalUrl),
        encodeForShell(snapshot.publicUrl),
        encodeForShell(snapshot.anonKey),
        snapshot.rolloutStatus,
        encodeForShell(snapshot.staffBusinessRbacMode),
        encodePossiblyEmptyForShell(snapshot.staffBusinessRbacSiteIds),
        encodePossiblyEmptyForShell(snapshot.canonicalPortalOrigin),
      ].join("\n"));
    } else if (mode === "process-snapshot") {
      if (process.argv.length !== 5) invalid();
      const snapshot = captureStableProductionProcessSupabaseEnvironment(
        process.argv[3],
        process.argv[4],
      );
      process.stdout.write(
        formatProductionProcessEnvironmentSnapshotForShell(snapshot),
      );
    } else {
      invalid();
    }
  } catch {
    process.exitCode = 1;
  }
}
