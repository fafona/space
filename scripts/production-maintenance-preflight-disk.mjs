import { lstatSync, realpathSync, statfsSync } from "node:fs";

// Read-only recovery gate. It neither frees space nor grants a runtime attempt.
// Keep the existing 5 GiB / 90% final-publish safety thresholds unchanged.
export const PREFLIGHT_MIN_FREE_BYTES = 5120n * 1024n * 1024n;
const APP = "/www/wwwroot/merchant-space";
const fail = () => { throw new Error("maintenance_preflight_disk_headroom_unverified"); };
export function validatePreflightDiskHeadroom(stat) {
  if (!stat || ["bsize", "blocks", "bfree", "bavail"].some(key => typeof stat[key] !== "bigint") ||
      stat.bsize <= 0n || stat.blocks <= 0n || stat.bavail < 0n || stat.bfree < stat.bavail || stat.blocks < stat.bfree ||
      stat.bavail * stat.bsize < PREFLIGHT_MIN_FREE_BYTES) fail();
  const used = stat.blocks - stat.bfree, usable = used + stat.bavail;
  if (usable <= 0n || (100n * used + usable - 1n) / usable >= 90n) fail();
  return true;
}
export function assertPreflightDiskHeadroom(state) {
  if (state?.appDir !== APP || ![10, 11].includes(state.version)) fail();
  for (const target of [APP, APP + ".releases"]) {
    const before = lstatSync(target, { bigint: true });
    if (!before.isDirectory() || before.isSymbolicLink() || before.uid !== 0n || (before.mode & 0o022n) !== 0n || realpathSync(target) !== target) fail();
    validatePreflightDiskHeadroom(statfsSync(target, { bigint: true }));
    const after = lstatSync(target, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.mode !== after.mode || before.uid !== after.uid || realpathSync(target) !== target) fail();
  }
  return true;
}
