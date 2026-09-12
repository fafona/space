import { createHash } from "node:crypto";
import { Buffer } from "node:buffer";
import * as filesystem from "node:fs";
import process from "node:process";
import { TextDecoder } from "node:util";
import { isProxy } from "node:util/types";
import { planMaintenanceLaunch, transitionMaintenanceLaunch, validateMaintenanceLaunchJournal } from "./production-maintenance-launch-journal.mjs";
import { assertMaintenanceContinuationProgress } from "./production-maintenance-continuation.mjs";

/** Private operation-state persistence; no process-control capability.
 * The caller MUST supply the existing operation lock, held until this callback
 * and its promise finish, and the strict full-state/operation validator. This
 * module neither implements that lock nor authenticates caller-supplied facts.
 * revision and launchJournal must ALREADY be in the ONE operation state.json.
 * Missing/corrupt state is never initialized. All writers must use that lock
 * and revision protocol; rename is not kernel CAS against unrelated writers.
 * File fsync -> rename -> parent fsync -> exact readback is required. An error
 * at ANY step means zero sends, including when rename may already have worked.
 * Failed temporary files are intentionally retained, not automatically removed
 * or replayed. No nonce, PM2 method, network call or send callback exists here.
 */
const ROOT = "/var/lib/faolla-maintenance";
const MAX_BYTES = 4 * 1024 * 1024;
const INVALID = "production_maintenance_launch_storage_invalid";
const CONFLICT = "production_maintenance_launch_storage_conflict";
const UNCONFIRMED = "production_maintenance_launch_storage_unconfirmed";
const fail = (code = UNCONFIRMED) => { throw new Error(code); };
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = (stat) => ["dev", "ino", "mode", "uid", "nlink", "size", "mtimeNs", "ctimeNs"].map((key) => String(stat[key])).join(":");
const directoryIdentity = (stat) => ["dev", "ino", "mode", "uid"].map((key) => String(stat[key])).join(":");

// Capture plain JSON descriptors before any await; no getters, proxies, toJSON,
// hidden fields, sparse arrays, coercion or silent undefined omission.
function captureJson(value, budget = { nodes: 0 }, depth = 0) {
  if (++budget.nodes > 100000 || depth > 64) fail(INVALID);
  if (value === null || typeof value === "boolean" || typeof value === "string") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (!value || typeof value !== "object" || isProxy(value)) fail(INVALID);
  const array = Array.isArray(value);
  if (!array && ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail(INVALID);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (array && (value.length > 100000 || keys.length !== value.length + 1)) fail(INVALID);
  const result = array ? [] : {};
  for (const key of keys) {
    if (array && key === "length") continue;
    const property = descriptors[key];
    if (typeof key !== "string" || !property.enumerable || !Object.hasOwn(property, "value") ||
        (array && (!/^(?:0|[1-9]\d*)$/.test(key) || Number(key) >= value.length))) fail(INVALID);
    Object.defineProperty(result, key, { value: captureJson(property.value, budget, depth + 1), enumerable: true, writable: true, configurable: true });
  }
  return result;
}
const encode = (value) => {
  const bytes = Buffer.from(JSON.stringify(captureJson(value)));
  if (bytes.length < 1 || bytes.length > MAX_BYTES) fail(INVALID);
  return bytes;
};
function exact(value, keys) {
  return value && typeof value === "object" && !Array.isArray(value) &&
    Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}
function frozen(value) {
  if (value && typeof value === "object") { for (const child of Object.values(value)) frozen(child); Object.freeze(value); }
  return value;
}

export function createMaintenanceLaunchJournalStorage(options, io = filesystem) {
  if (io === filesystem && (process.platform !== "linux" || process.getuid?.() !== 0)) fail(INVALID);
  if (!options || typeof options !== "object" || isProxy(options)) fail(INVALID);
  const descriptors = Object.getOwnPropertyDescriptors(options);
  const keys = ["appName", "withExistingOperationLock", "captureState"];
  if (Reflect.ownKeys(descriptors).length !== keys.length || !keys.every((key) => descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], "value"))) fail(INVALID);
  const { appName, withExistingOperationLock, captureState } = options;
  if (typeof appName !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(appName) ||
      typeof withExistingOperationLock !== "function" || typeof captureState !== "function") fail(INVALID);
  const directory = ROOT + "/" + appName;
  const statePath = directory + "/state.json";
  const temporary = directory + "/state.launch-journal.tmp";
  const { constants } = filesystem;

  function directories() {
    return ["/", "/var", "/var/lib", ROOT, directory].map((path) => {
      const stat = io.lstatSync(path, { bigint: true });
      if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== 0n || (stat.mode & 0o022n) !== 0n ||
          (path.startsWith(ROOT) && (stat.mode & 0o077n) !== 0n) || io.realpathSync(path) !== path) fail();
      return directoryIdentity(stat);
    });
  }
  function checkedState(raw, binding, operation = false) {
    if (!operation && (!binding || binding.appName !== appName)) fail(INVALID);
    const captured = captureJson(raw);
    if (!captured || typeof captured !== "object" || Array.isArray(captured) ||
        !Number.isSafeInteger(captured.revision) || captured.revision < 0 || !Object.hasOwn(captured, "launchJournal")) fail();
    if (operation && captured.appName !== appName) fail(INVALID);
    const validated = captureState(frozen(captureJson(captured)), frozen(captureJson(binding)));
    if (!encode(validated).equals(encode(captured))) fail(); // validators may not silently normalize/drop state
    if (!operation) validateMaintenanceLaunchJournal(captured.launchJournal, binding);
    return captured;
  }
  function read(binding, operation = false) {
    const before = io.lstatSync(statePath, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.uid !== 0n || before.nlink !== 1n ||
        (before.mode & 0o077n) !== 0n || before.size < 1n || before.size > BigInt(MAX_BYTES)) fail();
    const fd = io.openSync(statePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let bytes;
    try {
      if (identity(io.fstatSync(fd, { bigint: true })) !== identity(before)) fail();
      bytes = Buffer.alloc(Number(before.size) + 1); let size = 0;
      while (size < bytes.length) { const n = io.readSync(fd, bytes, size, bytes.length - size, null); if (!n) break; size += n; }
      if (size !== Number(before.size) || identity(io.fstatSync(fd, { bigint: true })) !== identity(before) ||
          identity(io.lstatSync(statePath, { bigint: true })) !== identity(before)) fail();
      bytes = bytes.subarray(0, size);
    } finally { io.closeSync(fd); }
    const raw = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    // The future single-state writer uses compact JSON. Reject duplicate JSON
    // keys and ambiguous encodings rather than reconstructing lost fields.
    if (!encode(raw).equals(bytes)) fail();
    const state = checkedState(raw, binding, operation);
    return { state, revision: state.revision, digest: digest(bytes), fileIdentity: identity(before) };
  }
  async function locked(task) {
    let entered = false; let result; const completed = {};
    try {
      const returned = await withExistingOperationLock(async () => {
        if (entered) fail(); entered = true;
        result = task(); return completed;
      });
      if (!entered || returned !== completed) fail();
      return result;
    } catch (error) { fail([INVALID, CONFLICT].includes(error?.message) ? error.message : UNCONFIRMED); }
  }
  // Private full-state snapshot, never a public receipt or a launch callback.
  const confirmedSnapshot = (snapshot) => frozen({ state: snapshot.state, revision: snapshot.revision, digest: snapshot.digest });

  function assertJournalProgress(previous, next) {
    const before = previous.launchJournal, after = next.launchJournal;
    if (previous.launchDisk !== null && !encode(previous.launchDisk).equals(encode(next.launchDisk))) fail(INVALID);
    if (before === null && after === null) return;
    if (after === null) fail(INVALID);
    const binding = Object.fromEntries(["operationId", "targetSha", "appName", "appPort", "daemon", "release"].map((key) => [key, after[key]]));
    const validated = validateMaintenanceLaunchJournal(after, binding);
    if (!encode(validated).equals(encode(after))) fail(INVALID);
    if (before === null) {
      if (Object.values(after.slots).some((entry) => entry !== null)) fail(INVALID);
      return;
    }
    validateMaintenanceLaunchJournal(before, binding);
    if (encode(before).equals(encode(after))) return;
    const changed = ["paused-web", "resumed-web", "worker"].filter((role) => !encode(before.slots[role]).equals(encode(after.slots[role])));
    if (changed.length !== 1) fail(INVALID);
    const role = changed[0], entry = after.slots[role]; if (!entry) fail(INVALID);
    let expected;
    if (before.slots[role] === null) {
      expected = planMaintenanceLaunch(before, binding, { role, sequence: entry.sequence, nonce: entry.nonce, environmentDigest: entry.environmentDigest });
    } else {
      const event = { role, sequence: entry.sequence, nonce: entry.nonce, phase: entry.phase };
      if (entry.phase === "confirmed") event.observation = { ...binding, role, sequence: entry.sequence,
        observedNonce: entry.nonce, environmentDigest: entry.environmentDigest, instance: entry.instance };
      expected = transitionMaintenanceLaunch(before, binding, event);
    }
    if (!encode(expected).equals(encode(after))) fail(INVALID);
  }

  function persist(previous, next, binding, parents, operation = false) {
    // Applies to both full-state replacement and journal-only writes, before
    // any temporary file is opened. Both audits are immutable; the continuation
    // wrapper delegates every legacy transition to the unchanged recovery guard.
    assertMaintenanceContinuationProgress(previous.state, next);
    const bytes = encode(next);
    const fd = io.openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    let temporaryIdentity;
    try {
      const stat = io.fstatSync(fd, { bigint: true });
      if (!stat.isFile() || stat.uid !== 0n || stat.nlink !== 1n || (stat.mode & 0o077n) !== 0n) fail();
      let written = 0;
      while (written < bytes.length) { const n = io.writeSync(fd, bytes, written, bytes.length - written, null); if (!Number.isInteger(n) || n <= 0) fail(); written += n; }
      io.fsyncSync(fd); temporaryIdentity = identity(io.fstatSync(fd, { bigint: true }));
    } finally { io.closeSync(fd); }
    const latest = read(binding, operation);
    if (latest.fileIdentity !== previous.fileIdentity || latest.digest !== previous.digest || latest.revision !== previous.revision) fail(CONFLICT);
    if (JSON.stringify(directories()) !== JSON.stringify(parents) ||
        identity(io.lstatSync(temporary, { bigint: true })) !== temporaryIdentity) fail();
    io.renameSync(temporary, statePath);
    const parent = io.openSync(directory, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
    try {
      if (directoryIdentity(io.fstatSync(parent, { bigint: true })) !== parents.at(-1)) fail();
      io.fsyncSync(parent);
    } finally { io.closeSync(parent); }
    const result = read(binding, operation);
    if (result.revision !== next.revision || result.digest !== digest(bytes) ||
        JSON.stringify(directories()) !== JSON.stringify(parents)) fail();
    return confirmedSnapshot(result);
  }

  return Object.freeze({
    readOperationUnderExistingOperationLock() {
      return locked(() => { const before = directories(), result = read(null, true);
        if (JSON.stringify(directories()) !== JSON.stringify(before)) fail(); return confirmedSnapshot(result); });
    },
    replaceOperationUnderExistingOperationLock(rawInput) {
      const input = captureJson(rawInput);
      if (!exact(input, ["expectedRevision", "expectedDigest", "next"]) || !Number.isSafeInteger(input.expectedRevision) ||
          input.expectedRevision < 0 || typeof input.expectedDigest !== "string" || !/^[a-f0-9]{64}$/.test(input.expectedDigest)) fail(INVALID);
      return locked(() => {
        const parents = directories(), previous = read(null, true);
        if (previous.revision !== input.expectedRevision || previous.digest !== input.expectedDigest) fail(CONFLICT);
        if (previous.revision === Number.MAX_SAFE_INTEGER) fail();
        const next = checkedState(input.next, null, true);
        if (next.revision !== previous.revision + 1) fail(INVALID);
        assertJournalProgress(previous.state, next);
        return persist(previous, next, null, parents, true);
      });
    },
    readUnderExistingOperationLock(rawBinding) {
      const binding = captureJson(rawBinding);
      return locked(() => { const before = directories(); const result = read(binding);
        if (JSON.stringify(directories()) !== JSON.stringify(before)) fail(); return confirmedSnapshot(result); });
    },
    applyUnderExistingOperationLock(rawInput) {
      const input = captureJson(rawInput);
      if (!exact(input, ["expectedRevision", "expectedDigest", "binding", "change"]) ||
          !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0 ||
          typeof input.expectedDigest !== "string" || !/^[a-f0-9]{64}$/.test(input.expectedDigest) ||
          !exact(input.change, ["type", "value"]) || !["plan", "transition"].includes(input.change.type)) fail(INVALID);
      return locked(() => {
        const parents = directories(); const previous = read(input.binding);
        if (previous.revision !== input.expectedRevision || previous.digest !== input.expectedDigest) fail(CONFLICT);
        if (previous.revision === Number.MAX_SAFE_INTEGER) fail();
        const change = input.change.type === "plan" ? planMaintenanceLaunch : transitionMaintenanceLaunch;
        const journal = change(previous.state.launchJournal, input.binding, input.change.value);
        const next = checkedState({ ...previous.state, revision: previous.revision + 1, launchJournal: journal }, input.binding);
        return persist(previous, next, input.binding, parents);
      });
    },
  });
}
