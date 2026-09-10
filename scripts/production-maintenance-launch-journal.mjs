import { posix } from "node:path";
import { isProxy } from "node:util/types";

/**
 * Pure launch-state contract, with NO I/O, randomness, PM2 calls or authority.
 *
 * The integrating caller must own ONE durable journal slot per maintenance
 * operation, validate against the trusted operation binding, and atomically
 * persist each next state against its actual previous state. Only a successfully
 * persisted planned -> attempted transition may precede a single launch send.
 * Creating another empty journal, losing the file, or racing writers is NOT
 * prevented by these pure functions. A returned object is not proof of a write.
 *
 * unknown is never permission to resend. Its only forward transition requires
 * an independently read launch nonce and exact instance observation; same name
 * or release alone is insufficient. Observations are data, not authentication:
 * the future adapter must derive them from the bound peer and frozen /proc data.
 * confirmed records identity only, NOT health, maintenance-held, successful
 * deployment, PM2 server-side atomic CAS, or permission to open public ingress.
 */
const INVALID = "production_maintenance_launch_journal_invalid";
const TRANSITION = "production_maintenance_launch_transition_invalid";
const MISMATCH = "production_maintenance_launch_binding_mismatch";
const ROLES = ["paused-web", "resumed-web", "worker"];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const BOOT = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const IDENTITY = /^(?:0|[1-9][0-9]{0,24})(?::(?:0|[1-9][0-9]{0,24})){7}$/;
const TICKS = /^[1-9][0-9]{0,24}$/;
const BINDING_KEYS = ["operationId", "targetSha", "appName", "appPort", "daemon", "release"];
const DAEMON_KEYS = ["pid", "uid", "startTicks", "bootId", "executable", "executableIdentity"];
const RELEASE_KEYS = ["path", "identity", "buildDigest"];
const ENTRY_KEYS = ["role", "sequence", "nonce", "environmentDigest", "phase", "instance"];
const INSTANCE_KEYS = ["pmId", "pid", "parentPid", "uid", "startTicks", "processIdentity", "cwd", "cwdIdentity",
  "executable", "executableIdentity", "commandLineDigest", "createdAt", "pmUptime", "restartTime", "metadataDigest"];
const OBSERVATION_KEYS = [...BINDING_KEYS, "role", "sequence", "observedNonce", "environmentDigest", "instance"];

function fail(code = INVALID) { throw new Error(code); }
const matches = (value, pattern) => typeof value === "string" && pattern.test(value);
const integer = (value, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) =>
  Number.isSafeInteger(value) && value >= minimum && value <= maximum;
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

// Inspect descriptors before reading values. Reject proxies without triggering
// their traps; reject symbols, hidden fields, getters and custom prototypes.
function record(value, keys) {
  if (!value || typeof value !== "object" || isProxy(value) || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || !keys.every((key) =>
    descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], "value"))) fail();
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}

function absolute(value) {
  return typeof value === "string" && value.length <= 500 && /^\/[A-Za-z0-9._/-]+$/.test(value) &&
    value !== "/" && !value.endsWith("/") && posix.normalize(value) === value;
}

function daemon(value) {
  const result = record(value, DAEMON_KEYS);
  if (!integer(result.pid, 1, 2147483647) || !integer(result.uid, 0, 4294967295) ||
      !matches(result.startTicks, TICKS) || !matches(result.bootId, BOOT) || !absolute(result.executable) ||
      !matches(result.executableIdentity, IDENTITY)) fail();
  return result;
}

function binding(value) {
  const result = record(value, BINDING_KEYS);
  if (!matches(result.operationId, UUID) || !matches(result.targetSha, SHA) ||
      !matches(result.appName, /^[A-Za-z0-9._-]{1,100}$/) || !integer(result.appPort, 1, 65535)) fail();
  result.daemon = daemon(result.daemon);
  result.release = record(result.release, RELEASE_KEYS);
  if (!absolute(result.release.path) || !matches(result.release.identity, IDENTITY) ||
      !matches(result.release.buildDigest, DIGEST) || !posix.dirname(result.release.path).endsWith(".releases") ||
      !new RegExp(`^${result.targetSha.slice(0, 12)}-[0-9]{14}$`).test(posix.basename(result.release.path))) fail();
  return result;
}

function instance(value, bound) {
  const result = record(value, INSTANCE_KEYS);
  if (!integer(result.pmId, 0, 2147483647) || !integer(result.pid, 1, 2147483647) ||
      result.pid === bound.daemon.pid || result.parentPid !== bound.daemon.pid || result.uid !== bound.daemon.uid ||
      !matches(result.startTicks, TICKS) || !matches(result.processIdentity, IDENTITY) ||
      result.cwd !== bound.release.path || result.cwdIdentity !== bound.release.identity ||
      result.executable !== bound.daemon.executable || result.executableIdentity !== bound.daemon.executableIdentity ||
      !matches(result.commandLineDigest, DIGEST) || !integer(result.createdAt, 1) || !integer(result.pmUptime, 1) ||
      !integer(result.restartTime, 0, 2147483647) || !matches(result.metadataDigest, DIGEST)) fail();
  return result;
}

function capture(value, expectedBinding) {
  const expected = binding(expectedBinding);
  const result = record(value, ["version", ...BINDING_KEYS, "slots"]);
  if (result.version !== 1) fail();
  const actual = binding(Object.fromEntries(BINDING_KEYS.map((key) => [key, result[key]])));
  if (!equal(actual, expected)) fail(MISMATCH);
  Object.assign(result, actual);
  result.slots = record(result.slots, ROLES);
  const nonces = new Set();
  for (const [index, role] of ROLES.entries()) {
    if (result.slots[role] === null) continue;
    const entry = record(result.slots[role], ENTRY_KEYS);
    if (entry.role !== role || entry.sequence !== index + 1 || !matches(entry.nonce, UUID) || nonces.has(entry.nonce) ||
        !matches(entry.environmentDigest, DIGEST) || !["planned", "attempted", "unknown", "confirmed"].includes(entry.phase) ||
        (index > 0 && result.slots[ROLES[index - 1]]?.phase !== "confirmed")) fail();
    nonces.add(entry.nonce);
    if (entry.phase === "confirmed") entry.instance = instance(entry.instance, actual);
    else if (entry.instance !== null) fail();
    result.slots[role] = entry;
  }
  return result;
}

function freeze(value) {
  for (const child of Object.values(value)) if (child && typeof child === "object") freeze(child);
  return Object.freeze(value);
}

export function createMaintenanceLaunchJournal(expectedBinding) {
  const bound = binding(expectedBinding);
  return freeze({ version: 1, ...bound, slots: Object.fromEntries(ROLES.map((role) => [role, null])) });
}

export function validateMaintenanceLaunchJournal(value, expectedBinding) {
  return freeze(capture(value, expectedBinding));
}

export function planMaintenanceLaunch(value, expectedBinding, request) {
  const result = capture(value, expectedBinding);
  const planned = record(request, ["role", "sequence", "nonce", "environmentDigest"]);
  const index = ROLES.indexOf(planned.role);
  if (index < 0 || planned.sequence !== index + 1 || !matches(planned.nonce, UUID) ||
      !matches(planned.environmentDigest, DIGEST)) fail();
  if (result.slots[planned.role] !== null || Object.values(result.slots).some((entry) => entry?.nonce === planned.nonce) ||
      (index > 0 && result.slots[ROLES[index - 1]]?.phase !== "confirmed")) fail(TRANSITION);
  result.slots[planned.role] = { ...planned, phase: "planned", instance: null };
  return freeze(result);
}

/** Only the persisted attempted transition authorizes a future adapter's one send. */
export function transitionMaintenanceLaunch(value, expectedBinding, event) {
  const result = capture(value, expectedBinding);
  // Determine the shape using a data descriptor, not an accessor or proxy.
  if (!event || typeof event !== "object" || isProxy(event)) fail();
  const phase = Object.getOwnPropertyDescriptor(event, "phase");
  if (!phase || !Object.hasOwn(phase, "value")) fail();
  const change = record(event, ["role", "sequence", "nonce", "phase", ...(phase.value === "confirmed" ? ["observation"] : [])]);
  if (!ROLES.includes(change.role) || !["attempted", "unknown", "confirmed"].includes(change.phase)) fail();
  const entry = result.slots[change.role];
  if (!entry || entry.sequence !== change.sequence || entry.nonce !== change.nonce) fail(TRANSITION);
  if (change.phase === "attempted") {
    if (entry.phase !== "planned") fail(TRANSITION);
    entry.phase = "attempted";
  } else if (change.phase === "unknown") {
    if (entry.phase !== "attempted") fail(TRANSITION);
    entry.phase = "unknown";
  } else {
    if (!["attempted", "unknown", "confirmed"].includes(entry.phase)) fail(TRANSITION);
    const observed = record(change.observation, OBSERVATION_KEYS);
    const observedBinding = binding(Object.fromEntries(BINDING_KEYS.map((key) => [key, observed[key]])));
    if (!equal(observedBinding, binding(expectedBinding)) || observed.role !== entry.role || observed.sequence !== entry.sequence ||
        observed.observedNonce !== entry.nonce || observed.environmentDigest !== entry.environmentDigest) fail(MISMATCH);
    const observedInstance = instance(observed.instance, observedBinding);
    if (entry.phase === "confirmed" && !equal(entry.instance, observedInstance)) fail(MISMATCH);
    entry.phase = "confirmed";
    entry.instance = observedInstance;
  }
  return freeze(result);
}
