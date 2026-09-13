import { createHash } from "node:crypto";
import { posix } from "node:path";
import { types } from "node:util";

// Historical continuity only, NOT authority to operate a process. Callers still
// verify the real boot, held state, exact PM2 title/environment and SO_PEERCRED.
// Never use this comparison between two fresh observations: those remain exact.
const KEYS = ["pid", "parentPid", "startTicks", "processIdentity", "uid", "cwd", "cwdIdentity", "executable", "executableIdentity", "commandLineDigest"];
const PINNED_BOOT = "e6531ec9-db4a-4216-b87a-7cc858197eaa";
const PINNED_DAEMON_DIGEST = "940d18ed1876a97c6523b56bc213be2c426c89348630527392d9d795dadef6c4";
const IDENTITY = /^\d{1,25}(?::\d{1,25}){7}$/;
const BOOT = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const fail = () => { throw new Error("production_maintenance_daemon_continuity_unverified"); };
const integer = (value, minimum, maximum) => Number.isSafeInteger(value) && !Object.is(value, -0) && value >= minimum && value <= maximum;
const absolute = value => typeof value === "string" && value.length > 1 && value.length <= 4096 &&
  !/[\0\r\n]/.test(value) && value.startsWith("/") && !value.endsWith("/") && posix.normalize(value) === value;
function capture(value) {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== KEYS.length || !KEYS.every(key =>
    descriptors[key]?.enumerable && Object.hasOwn(descriptors[key], "value"))) fail();
  const result = Object.fromEntries(KEYS.map(key => [key, descriptors[key].value]));
  if (!integer(result.pid, 1, 2147483647) || !integer(result.parentPid, 0, 2147483647) || !integer(result.uid, 0, 4294967295) ||
      typeof result.startTicks !== "string" || !/^[1-9]\d{0,24}$/.test(result.startTicks) ||
      !["processIdentity", "cwdIdentity", "executableIdentity"].every(key => typeof result[key] === "string" && IDENTITY.test(result[key])) ||
      !(result.cwd === "/" || absolute(result.cwd)) || !absolute(result.executable) ||
      typeof result.commandLineDigest !== "string" || !/^[a-f0-9]{64}$/.test(result.commandLineDigest)) fail();
  return result;
}

export function assertMaintenanceDaemonContinuity(rawFrozen, rawObserved, bootId) {
  const frozen = capture(rawFrozen), observed = capture(rawObserved);
  if (typeof bootId !== "string" || !BOOT.test(bootId)) fail();
  if (KEYS.every(key => frozen[key] === observed[key])) return;
  // /proc creates virtual inode numbers/timestamps on instantiation. Only the
  // explicitly approved, original frozen daemon on its original boot may have
  // these three historical fields differ. No saved proof is refreshed/replaced.
  if (bootId !== PINNED_BOOT || createHash("sha256").update(JSON.stringify(frozen)).digest("hex") !== PINNED_DAEMON_DIGEST ||
      KEYS.some(key => key !== "processIdentity" && frozen[key] !== observed[key])) fail();
  const original = frozen.processIdentity.split(":"), current = observed.processIdentity.split(":");
  if ([0, 2, 5, 6, 7].some(index => original[index] !== current[index])) fail();
}
